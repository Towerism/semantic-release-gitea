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
    if (name.startsWith('sr-e2e-')) {
      // A cleanup failure must not replace the failure that got us here; say which repository is left.
      await api('DELETE', `/repos/${TEST_USER}/${name}`).catch((error) => {
        console.error(`Could not delete the throwaway repository ${name}: ${error.message}`);
      });
    }
  }
});

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base64 = (/** @type {string} */ text) => Buffer.from(text).toString('base64');

test('all five steps comment on released pull requests and issues and report a failed release on a real Gitea server', { skip: missing.length > 0 && process.env.E2E_REQUIRED !== 'true' }, async () => {
  assert.deepEqual(missing, [], `E2E_REQUIRED is true, but these variables are not set: ${missing.join(', ')}`);
  const base = new URL(/** @type {string} */ (URL_TEXT));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  assert.ok(base.protocol === 'https:' || (base.protocol === 'http:' && local), 'GITEA_E2E_URL must use https (http only for localhost)');
  const root = base.origin;
  const api = createApi({ root, token: /** @type {string} */ (TOKEN) });

  const user = await api('GET', '/user');
  assert.equal(user.body?.login, TEST_USER, `the token must belong to the ${TEST_USER} user`);

  const name = `sr-e2e-${Date.now() + 1}`;
  assert.match(name, /^sr-e2e-\d+$/);
  const created = await api('POST', '/user/repos', { name, auto_init: true, default_branch: 'main', private: true });
  assert.equal(created.status, 201, 'the throwaway repository should be created');
  const repoPath = `/repos/${TEST_USER}/${name}`;
  /** Numbers and statuses only: the Actions log is public, so nothing from a response body is printed. @type {Record<string, unknown>} */
  const measured = {};

  try {
    await api('PATCH', repoPath, { allow_merge_commits: true, allow_squash_merge: true, allow_rebase: true, allow_rebase_explicit: true });

    // An issue that the first pull request closes, then one pull request for each merge style.
    const issue = await api('POST', `${repoPath}/issues`, { title: 'A bug to fix' });
    assert.equal(issue.status, 201);
    const styles = /** @type {const} */ ([
      { style: 'merge-commit', Do: 'merge', body: `Closes #${issue.body.number}` },
      { style: 'squash', Do: 'squash', body: '' },
      { style: 'rebase', Do: 'rebase', body: '' },
    ]);
    /** @type {Array<{ style: string, number: number }>} */
    const pulls = [];
    for (const { style, Do, body } of styles) {
      const branch = `sr-pr-${style}`;
      const first = await api('POST', `${repoPath}/contents/${style}-1.txt`, { content: base64('one'), message: `${style} one`, branch: 'main', new_branch: branch });
      const second = await api('POST', `${repoPath}/contents/${style}-2.txt`, { content: base64('two'), message: `${style} two`, branch });
      assert.deepEqual([first.status, second.status], [201, 201], `the ${style} branch should be created`);
      const pull = await api('POST', `${repoPath}/pulls`, { head: branch, base: 'main', title: `${style} pull request`, body });
      assert.equal(pull.status, 201, `the ${style} pull request should be created`);
      let merge = await api('POST', `${repoPath}/pulls/${pull.body.number}/merge`, { Do });
      for (let attempt = 0; merge.status !== 200 && attempt < 20; attempt += 1) {
        await sleep(1000);
        merge = await api('POST', `${repoPath}/pulls/${pull.body.number}/merge`, { Do });
      }
      assert.equal(merge.status, 200, `the ${style} pull request should merge`);
      const detail = await api('GET', `${repoPath}/pulls/${pull.body.number}`);
      measured[`${style}Pull`] = { merged: detail.body.merged, hasMergeCommitSha: typeof detail.body.merge_commit_sha === 'string' };
      pulls.push({ style, number: pull.body.number });
    }

    // The released commits are everything now on main.
    const log = await api('GET', `${repoPath}/commits?sha=main&limit=30&stat=false&verification=false&files=false`);
    /** @type {Array<{ hash: string, message: string }>} */
    const commits = log.body.map((/** @type {any} */ c) => ({ hash: c.sha, message: c.commit.message }));
    for (const { style, number } of pulls) {
      const detail = await api('GET', `${repoPath}/pulls/${number}`);
      measured[`${style}Pull`] = {
        .../** @type {object} */ (measured[`${style}Pull`]),
        mergeCommitSha: commits.some((c) => c.hash === detail.body.merge_commit_sha) ? 'in the released commits' : 'not in the released commits',
      };
    }
    const asIssue = await api('GET', `${repoPath}/issues/${pulls[0].number}`);
    measured.pullFetchedAsIssue = { status: asIssue.status, hasPullRequestField: Boolean(asIssue.body?.pull_request) };

    const tag = await api('POST', `${repoPath}/tags`, { tag_name: 'v1.0.0', target: 'main' });
    assert.equal(tag.status, 201);

    const context = (/** @type {Record<string, unknown>} */ more = {}) =>
      /** @type {import('../index.js').Context} */ (
        /** @type {unknown} */ ({
          cwd: process.cwd(),
          env: { GITEA_TOKEN: TOKEN, GITEA_URL: root },
          options: { repositoryUrl: `${root}/${TEST_USER}/${name}.git` },
          logger: { log() {}, warn() {}, error() {}, success() {} },
          branch: { name: 'main', type: 'release', main: true, prerelease: false },
          nextRelease: { version: '1.0.0', gitTag: 'v1.0.0', gitHead: commits[0].hash, name: '1.0.0', notes: 'Notes for v1.0.0', type: 'minor', channel: null },
          commits,
          errors: [Object.assign(new Error('The e2e failure'), { details: 'This is a test, not a real failure.' })],
          ...more,
        })
      );
    /** @type {import('../index.js').PluginConfig} */
    const config = { addReleases: 'bottom', labels: ['sr-e2e-label'] };

    // verifyConditions, publish and addChannel, then success with a second plugin's release listed.
    await plugin.verifyConditions(config, context());
    const published = await plugin.publish(config, context());
    await plugin.addChannel(config, context());
    const releases = [published, { name: 'npm package', url: 'https://npm.example/p' }];
    await plugin.success(config, context({ releases }));

    // Every pull request, and the issue the first one closed, has the comment and the label.
    for (const number of [issue.body.number, ...pulls.map((p) => p.number)]) {
      const comments = await api('GET', `${repoPath}/issues/${number}/comments`);
      assert.equal(comments.body.filter((/** @type {{ body: string }} */ c) => c.body.includes('in version 1.0.0')).length, 1, `#${number} should have one release comment`);
      const labels = await api('GET', `${repoPath}/issues/${number}/labels`);
      assert.deepEqual(labels.body.map((/** @type {{ name: string }} */ l) => l.name), ['released'], `#${number} should carry the released label`);
    }
    const release = await api('GET', `${repoPath}/releases/tags/v1.0.0`);
    assert.match(release.body.body, /This release is also available on:\n- \[npm package\]\(https:\/\/npm\.example\/p\)/);

    // A failed release opens one issue, a second failure comments on it, and the next success closes it.
    const failureIssues = async () => {
      const list = await api('GET', `${repoPath}/issues?state=open&type=issues&labels=semantic-release&limit=50`);
      return list.body.filter((/** @type {{ body: string }} */ i) => i.body.includes('<!-- semantic-release:gitea -->'));
    };
    await plugin.fail(config, context());
    const afterFirst = await failureIssues();
    assert.equal(afterFirst.length, 1, 'the first failure should open one issue');
    assert.match(afterFirst[0].body, /The e2e failure/);
    await plugin.fail(config, context());
    const afterSecond = await failureIssues();
    assert.equal(afterSecond.length, 1, 'the second failure should not open another issue');
    const failureComments = await api('GET', `${repoPath}/issues/${afterSecond[0].number}/comments`);
    assert.equal(failureComments.body.length, 1, 'the second failure should add one comment');

    // What Gitea does with the label filter, which the plugin leaves to the marker (docs/gitea-api-verification.md).
    const countFor = async (/** @type {string} */ labels) => {
      const list = await api('GET', `${repoPath}/issues?state=open&type=issues&labels=${encodeURIComponent(labels)}&limit=50`);
      return list.status === 200 ? list.body.length : `status ${list.status}`;
    };
    measured.labelFilter = {
      openIssues: await countFor(''),
      existingLabel: await countFor('semantic-release'),
      unknownLabel: await countFor('sr-e2e-unknown'),
      existingAndUnknown: await countFor('semantic-release,sr-e2e-unknown'),
      existingAndOtherExisting: await countFor('semantic-release,sr-e2e-label'),
    };
    await plugin.success(config, context({ commits: [], releases }));
    assert.equal((await failureIssues()).length, 0, 'the next success should close the failure issue');
    const closed = await api('GET', `${repoPath}/issues/${afterSecond[0].number}`);
    assert.equal(closed.body.state, 'closed');

    // Last, because it leaves two labels with one name: what Gitea does when a label is created twice, and what a
    // listing by that label name then returns for an issue that has one of them.
    const labelList = await api('GET', `${repoPath}/labels`);
    const existing = labelList.body.find((/** @type {{ name: string }} */ l) => l.name === 'semantic-release');
    const probe = await api('POST', `${repoPath}/issues`, { title: 'Probe', labels: [existing.id] });
    const before = await countFor('semantic-release');
    const duplicate = await api('POST', `${repoPath}/labels`, { name: 'semantic-release', color: 'ededed' });
    measured.duplicateLabel = { createStatus: duplicate.status, openIssuesWithTheLabelBefore: before, after: await countFor('semantic-release'), probeStatus: probe.status };
  } finally {
    // Printed even when an assertion above failed, so a failed run still leaves its measurements.
    console.log(`MEASURED ${JSON.stringify(measured)}`);
    if (name.startsWith('sr-e2e-')) {
      await api('DELETE', repoPath).catch((error) => {
        console.error(`Could not delete the throwaway repository ${name}: ${error.message}`);
      });
    }
  }
});
