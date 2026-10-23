import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as plugin from '../index.js';
import { fixture, serve } from './support/server.mjs';

// The real client and the real index.js, against a local server that replays fixtures, for the
// success and fail steps. The fixtures are synthetic: they follow the shapes Gitea documents and
// the verification record, and the end-to-end test is what checks them against a real server.

const TOKEN = 'tok-1234567890abcdef';
const API = '/api/v1/repos/owner/repo';

/** @param {unknown} body @param {number} [status] */
const inline = (body, status = 200) => ({ source: 'synthetic', giteaVersion: null, status, body });

/**
 * Answers like Gitea for the paths the two steps use.
 * @param {{ openIssues?: 'none' | 'one failure issue' }} [options]
 */
async function giteaServer({ openIssues = 'one failure issue' } = {}) {
  return serve([
    (req, res) => {
      const [path, query] = String(req.url).split('?');
      const route = `${req.method} ${path}`;
      /** @type {import('./support/server.mjs').Fixture} */
      let answer = fixture('not-found');
      if (route === 'GET /api/v1/version') answer = fixture('version');
      else if (route === `GET ${API}`) answer = fixture('repo');
      else if (route === `GET ${API}/commits/abc1/pull`) answer = fixture('pull-request');
      else if (route === `GET ${API}/pulls/9`) answer = inline({ number: 9, body: '', state: 'closed', merged: true, merge_commit_sha: 'not-released', html_url: 'https://gitea.example/owner/repo/pulls/9' });
      else if (route === `GET ${API}/pulls/9/commits`) answer = fixture('pull-commits');
      else if (route === `GET ${API}/issues/12`) answer = fixture('issue');
      else if (/^POST \/api\/v1\/repos\/owner\/repo\/issues\/\d+\/comments$/.test(route)) answer = fixture('comment-created');
      else if (/^POST \/api\/v1\/repos\/owner\/repo\/issues\/\d+\/labels$/.test(route)) answer = fixture('labels-added');
      else if (route === `GET ${API}/labels`) answer = fixture('labels-list');
      else if (route === `POST ${API}/labels`) answer = fixture('label-created');
      else if (route === `GET ${API}/issues` && query?.startsWith('state=open')) answer = openIssues === 'none' ? inline([]) : fixture('issues-open');
      else if (route === `POST ${API}/issues`) answer = fixture('issue-created');
      else if (route === `PATCH ${API}/issues/3`) answer = fixture('issue');
      else if (route === `PATCH ${API}/releases/12`) answer = fixture('release-published');
      res.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    },
  ]);
}

let contexts = 0;

/**
 * Each test gets a repository URL of its own because verified results are kept for the whole process.
 * @param {string} url
 * @param {Record<string, unknown>} [more]
 */
function contextFor(url, more = {}) {
  contexts += 1;
  const noop = () => {};
  return /** @type {import('../index.js').Context} */ (
    /** @type {unknown} */ ({
      env: { GITEA_TOKEN: TOKEN, GITEA_URL: url },
      options: { repositoryUrl: `${url}/owner/repo.git#success-fail-${contexts}` },
      logger: { log: noop, warn: noop, error: noop, success: noop },
      branch: { name: 'main' },
      nextRelease: { version: '1.2.0', gitTag: 'v1.2.0', channel: null, notes: 'Release notes', name: '1.2.0' },
      commits: [],
      errors: [],
      ...more,
    })
  );
}

/** @param {{ method: string, url: string }[]} requests */
const routes = (requests) => requests.map((request) => `${request.method} ${request.url}`).sort();

test('success sends the requests, paths and bodies Gitea documents for comments, labels, closing and the release body', async () => {
  const server = await giteaServer();
  try {
    const context = contextFor(server.url, {
      commits: [
        { hash: 'abc1', message: 'feat: handle an empty list (#7)' },
        { hash: 'def2', message: 'chore: tidy' },
      ],
      releases: [
        { name: 'Gitea release', url: 'https://gitea.example/owner/repo/releases/tag/v1.2.0', id: 12 },
        { name: 'npm package', url: 'https://npm.example/p' },
      ],
    });
    await plugin.success({ addReleases: 'bottom' }, context);

    assert.deepEqual(routes(server.requests), [
      'GET /api/v1/repos/owner/repo',
      'GET /api/v1/repos/owner/repo/commits/abc1/pull',
      'GET /api/v1/repos/owner/repo/commits/def2/pull',
      'GET /api/v1/repos/owner/repo/issues/12',
      'GET /api/v1/repos/owner/repo/issues?state=open&type=issues',
      'GET /api/v1/repos/owner/repo/labels',
      'GET /api/v1/version',
      'PATCH /api/v1/repos/owner/repo/issues/3',
      'PATCH /api/v1/repos/owner/repo/releases/12',
      'POST /api/v1/repos/owner/repo/issues/12/comments',
      'POST /api/v1/repos/owner/repo/issues/12/labels',
      'POST /api/v1/repos/owner/repo/issues/7/comments',
      'POST /api/v1/repos/owner/repo/issues/7/labels',
      'POST /api/v1/repos/owner/repo/labels',
    ]);
    const find = (/** @type {string} */ method, /** @type {string} */ url) => server.requests.find((r) => r.method === method && r.url === url);
    const comment = JSON.parse(find('POST', `${API}/issues/7/comments`)?.body ?? '{}');
    assert.match(comment.body, /PR is included in version 1\.2\.0/);
    assert.match(JSON.parse(find('POST', `${API}/issues/12/comments`)?.body ?? '{}').body, /issue has been resolved in version 1\.2\.0/);
    assert.deepEqual(JSON.parse(find('POST', `${API}/labels`)?.body ?? '{}'), { name: 'released', color: 'ededed' });
    assert.deepEqual(JSON.parse(find('POST', `${API}/issues/7/labels`)?.body ?? '{}'), { labels: [9] });
    assert.deepEqual(JSON.parse(find('PATCH', `${API}/issues/3`)?.body ?? '{}'), { state: 'closed' });
    assert.equal(JSON.parse(find('PATCH', `${API}/releases/12`)?.body ?? '{}').body, 'Release notes\n---\nThis release is also available on:\n- [npm package](https://npm.example/p)');
    for (const request of server.requests) assert.equal(request.headers.authorization, `token ${TOKEN}`);
    assert.equal(
      server.requests.filter((r) => r.method === 'GET' && r.url === `${API}/labels`).length,
      1,
      'the labels are listed once for the whole run',
    );
  } finally {
    await server.close();
  }
});

test('success finds a pull request named by (#N) through its details and its commits, and comments under that number', async () => {
  const server = await giteaServer();
  try {
    const context = contextFor(server.url, { commits: [{ hash: 'ghi3', message: 'fix: handle a retry (#9)' }] });
    await plugin.success({ releasedLabels: false }, context);
    const sent = routes(server.requests).filter((route) => /\/(pulls|issues\/9)/.test(route));
    assert.deepEqual(sent, [
      'GET /api/v1/repos/owner/repo/pulls/9',
      'GET /api/v1/repos/owner/repo/pulls/9/commits',
      'POST /api/v1/repos/owner/repo/issues/9/comments',
    ].sort());
    assert.match(JSON.parse(server.requests.find((r) => r.url === `${API}/issues/9/comments`)?.body ?? '{}').body, /PR is included in version 1\.2\.0/);
  } finally {
    await server.close();
  }
});

test('fail with no open failure issue creates one with the label ids, the title and the marker, and never reads /version', async () => {
  const server = await giteaServer({ openIssues: 'none' });
  try {
    const context = contextFor(server.url, { errors: [Object.assign(new Error('The npm token is invalid'), { details: 'Set NPM_TOKEN.' })] });
    await plugin.fail({ assignees: ['alice'] }, context);

    assert.deepEqual(routes(server.requests), [
      'GET /api/v1/repos/owner/repo',
      'GET /api/v1/repos/owner/repo/issues?state=open&type=issues',
      'GET /api/v1/repos/owner/repo/labels',
      'POST /api/v1/repos/owner/repo/issues',
      'POST /api/v1/repos/owner/repo/labels',
    ]);
    const issue = JSON.parse(server.requests.find((r) => r.method === 'POST' && r.url === `${API}/issues`)?.body ?? '{}');
    assert.equal(issue.title, 'The automated release is failing 🚨');
    assert.deepEqual(issue.labels, [9]);
    assert.deepEqual(issue.assignees, ['alice']);
    assert.match(issue.body, /The npm token is invalid/);
    assert.match(issue.body, /\n\n<!-- semantic-release:gitea -->$/);
    for (const request of server.requests) assert.equal(request.headers.authorization, `token ${TOKEN}`);
  } finally {
    await server.close();
  }
});

test('fail with an open failure issue comments on it and creates nothing', async () => {
  const server = await giteaServer();
  try {
    await plugin.fail({}, contextFor(server.url, { errors: [new Error('Again')] }));
    assert.deepEqual(routes(server.requests), [
      'GET /api/v1/repos/owner/repo',
      'GET /api/v1/repos/owner/repo/issues?state=open&type=issues',
      'POST /api/v1/repos/owner/repo/issues/3/comments',
    ]);
    const body = JSON.parse(server.requests[2].body).body;
    assert.match(body, /Again/);
    assert.doesNotMatch(body, /semantic-release:gitea/);
  } finally {
    await server.close();
  }
});
