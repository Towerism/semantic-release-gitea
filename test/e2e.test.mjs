import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as plugin from '../index.js';
import { createApi } from './support/gitea-api.mjs';

// End to end, against a real Gitea server (ADR-0006). Runs only when GITEA_E2E_URL and
// GITEA_E2E_TOKEN are set. The token must belong to the `testing` user. Each run creates a
// repository named sr-e2e-<milliseconds since epoch>, releases to it, and deletes it.
// When E2E_REQUIRED is "true" (the e2e.yml workflow sets it), a missing variable fails the
// test instead of skipping it, so a renamed secret cannot leave CI green with nothing run.

const URL_TEXT = process.env.GITEA_E2E_URL;
const TOKEN = process.env.GITEA_E2E_TOKEN;
const TEST_USER = 'testing';
const missing = [['GITEA_E2E_URL', URL_TEXT], ['GITEA_E2E_TOKEN', TOKEN]].filter(([, value]) => !value).map(([name]) => name);

test('publish and addChannel release to a throwaway repository on a real Gitea server', { skip: missing.length > 0 && process.env.E2E_REQUIRED !== 'true' }, async () => {
  assert.deepEqual(missing, [], `E2E_REQUIRED is true, but these variables are not set: ${missing.join(', ')}`);
  const base = new URL(/** @type {string} */ (URL_TEXT));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  assert.ok(base.protocol === 'https:' || (base.protocol === 'http:' && local), 'GITEA_E2E_URL must use https (http only for localhost)');
  const root = base.origin;

  const api = createApi({ root, token: /** @type {string} */ (TOKEN) });

  const user = await api('GET', '/user');
  assert.equal(user.body?.login, TEST_USER, `the token must belong to the ${TEST_USER} user`);

  const name = `sr-e2e-${Date.now()}`;
  assert.match(name, /^sr-e2e-\d+$/);
  const created = await api('POST', '/user/repos', { name, auto_init: true, default_branch: 'main', private: true });
  assert.equal(created.status, 201, 'the throwaway repository should be created');
  const cwd = await mkdtemp(join(tmpdir(), 'sr-gitea-e2e-'));

  try {
    await writeFile(join(cwd, 'asset.txt'), 'hello from the e2e test');
    const repoPath = `/repos/${TEST_USER}/${name}`;
    const release = (/** @type {string} */ tag, /** @type {Record<string, unknown>} */ branch = { name: 'main', type: 'release', main: true, prerelease: false }) =>
      /** @type {import('../index.js').Context} */ (
        /** @type {unknown} */ ({
          cwd,
          env: { GITEA_TOKEN: TOKEN, GITEA_URL: root },
          options: { repositoryUrl: `${root}/${TEST_USER}/${name}.git` },
          logger: { log() {}, warn() {}, error() {}, success() {} },
          branch,
          nextRelease: { version: tag.slice(1), gitTag: tag, gitHead: 'unused', name: tag.slice(1), notes: `Notes for ${tag}`, type: 'minor', channel: null },
        })
      );

    // A release without assets.
    await plugin.publish({}, release('v1.0.0'));
    const plain = await api('GET', `${repoPath}/releases/tags/v1.0.0`);
    assert.equal(plain.status, 200);
    assert.equal(plain.body.name, '1.0.0');
    assert.equal(plain.body.body, 'Notes for v1.0.0');
    assert.equal(plain.body.draft, false);
    assert.equal(plain.body.prerelease, false);

    // A release with an asset: published, with the file attached.
    await plugin.publish({ assets: ['asset.txt'] }, release('v1.1.0'));
    const withFile = await api('GET', `${repoPath}/releases/tags/v1.1.0`);
    assert.equal(withFile.body.draft, false);
    assert.deepEqual(withFile.body.assets.map((/** @type {{ name: string }} */ asset) => asset.name), ['asset.txt']);

    // As in a real run, semantic-release has already pushed the tag when publish starts.
    const tag = await api('POST', `${repoPath}/tags`, { tag_name: 'v1.3.0', target: 'main' });
    assert.equal(tag.status, 201, 'the tag should be created before publish');
    await plugin.publish({ assets: ['asset.txt'] }, release('v1.3.0'));
    const tagged = await api('GET', `${repoPath}/releases/tags/v1.3.0`);
    assert.equal(tagged.body.tag_name, 'v1.3.0');
    assert.equal(tagged.body.draft, false);
    assert.deepEqual(tagged.body.assets.map((/** @type {{ name: string }} */ asset) => asset.name), ['asset.txt']);

    // addChannel changes an existing release...
    await plugin.addChannel({}, release('v1.0.0', { name: 'next', type: 'prerelease', main: false, prerelease: 'next' }));
    const moved = await api('GET', `${repoPath}/releases/tags/v1.0.0`);
    assert.equal(moved.body.prerelease, true);

    // ...and creates one that is missing.
    await plugin.addChannel({}, release('v1.2.0'));
    const added = await api('GET', `${repoPath}/releases/tags/v1.2.0`);
    assert.equal(added.status, 200);
    assert.equal(added.body.body, 'Notes for v1.2.0');
  } finally {
    await rm(cwd, { recursive: true, force: true });
    if (name.startsWith('sr-e2e-')) await api('DELETE', `/repos/${TEST_USER}/${name}`);
  }
});
