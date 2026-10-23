import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as plugin from '../index.js';
import { fixture, serve } from './support/server.mjs';

// The real client and the real index.js, against a local server that replays fixtures.

const TOKEN = 'tok-1234567890abcdef';
const API = '/api/v1/repos/owner/repo';

/**
 * Answers like Gitea for the paths the release steps use. `missingTag` makes the
 * lookup by tag answer 404.
 * @param {{ missingTag?: boolean }} [options]
 */
async function giteaServer({ missingTag = false } = {}) {
  const server = await serve([
    (req, res) => {
      const route = `${req.method} ${String(req.url).split('?')[0]}`;
      /** @type {import('./support/server.mjs').Fixture} */
      let answer = fixture('not-found');
      if (route === 'GET /api/v1/version') answer = fixture('version');
      else if (route === 'GET /api/v1/repos/owner/repo') answer = fixture('repo');
      else if (route === `POST ${API}/releases`) answer = fixture('release-draft');
      else if (route === `POST ${API}/releases/12/assets`) answer = fixture('release-asset');
      else if (route === `PATCH ${API}/releases/12`) answer = fixture('release-published');
      else if (route === `GET ${API}/releases/tags/v1.2.0` && !missingTag) answer = fixture('release-published');
      res.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    },
  ]);
  return server;
}

let contexts = 0;

/**
 * Each test gets a repository URL of its own (a fragment, which the parser ignores) because
 * verified results are kept for the whole process.
 * @param {string} url
 * @param {string} cwd
 */
function contextFor(url, cwd) {
  contexts += 1;
  const noop = () => {};
  return /** @type {import('../index.js').Context} */ (
    /** @type {unknown} */ ({
      cwd,
      env: { GITEA_TOKEN: TOKEN, GITEA_URL: url },
      options: { repositoryUrl: `${url}/owner/repo.git#release-${contexts}` },
      logger: { log: noop, warn: noop, error: noop, success: noop },
      branch: { name: 'main', type: 'release', main: true, prerelease: false },
      nextRelease: { version: '1.2.0', gitTag: 'v1.2.0', gitHead: 'abc', name: '1.2.0', notes: 'Release notes', type: 'minor', channel: null },
    })
  );
}

/** @param {{ method: string, url: string }[]} requests */
const routes = (requests) => requests.map((request) => `${request.method} ${request.url}`);

test('publish verifies the setup once, then releases a file with the paths, methods and multipart body Gitea documents', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sr-gitea-contract-'));
  const server = await giteaServer();
  try {
    await writeFile(join(cwd, 'a.txt'), 'alpha');
    const context = contextFor(server.url, cwd);
    const result = await plugin.publish({ assets: ['a.txt'] }, context);

    assert.deepEqual(routes(server.requests), [
      'GET /api/v1/version',
      `GET ${API}`,
      `POST ${API}/releases`,
      `POST ${API}/releases/12/assets?name=a.txt`,
      `PATCH ${API}/releases/12`,
    ]);
    assert.deepEqual(JSON.parse(server.requests[2].body), {
      tag_name: 'v1.2.0',
      target_commitish: 'main',
      name: '1.2.0',
      body: 'Release notes',
      draft: true,
      prerelease: false,
    });
    const upload = server.requests[3];
    assert.match(String(upload.headers['content-type']), /^multipart\/form-data; boundary=/);
    assert.match(upload.body, /name="attachment"; filename="a\.txt"/);
    assert.match(upload.body, /\r\n\r\nalpha\r\n/);
    assert.deepEqual(JSON.parse(server.requests[4].body), { draft: false });
    assert.deepEqual(result, { url: 'https://gitea.example/owner/repo/releases/tag/v1.2.0', name: 'Gitea release', id: 12 });
    for (const request of server.requests) assert.equal(request.headers.authorization, `token ${TOKEN}`);

    // A second step with the same setup does not verify again.
    const before = server.requests.length;
    await plugin.addChannel({ assets: ['a.txt'] }, context);
    const added = routes(server.requests.slice(before));
    assert.deepEqual(added, [`GET ${API}/releases/tags/v1.2.0`, `PATCH ${API}/releases/12`]);
  } finally {
    await server.close();
    await rm(cwd, { recursive: true, force: true });
  }
});

test('addChannel updates a release that exists and creates one that does not', async () => {
  const existing = await giteaServer();
  const missing = await giteaServer({ missingTag: true });
  try {
    const update = await plugin.addChannel({}, contextFor(existing.url, process.cwd()));
    assert.deepEqual(routes(existing.requests).slice(2), [`GET ${API}/releases/tags/v1.2.0`, `PATCH ${API}/releases/12`]);
    assert.deepEqual(JSON.parse(existing.requests[3].body), { tag_name: 'v1.2.0', name: '1.2.0', prerelease: false });
    assert.equal(update.url, 'https://gitea.example/owner/repo/releases/tag/v1.2.0');

    await plugin.addChannel({}, contextFor(missing.url, process.cwd()));
    assert.deepEqual(routes(missing.requests).slice(2), [`GET ${API}/releases/tags/v1.2.0`, `POST ${API}/releases`]);
    assert.equal(JSON.parse(missing.requests[3].body).body, 'Release notes');
  } finally {
    await existing.close();
    await missing.close();
  }
});

test('publish with a bad option fails in verification before any release request', async () => {
  const server = await giteaServer();
  try {
    await assert.rejects(plugin.publish({ labels: /** @type {any} */ ([5]) }, contextFor(server.url, process.cwd())));
    assert.ok(!routes(server.requests).some((route) => route.includes('/releases')), 'no release request was sent');
  } finally {
    await server.close();
  }
});
