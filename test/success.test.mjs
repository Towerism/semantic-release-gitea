import { test } from 'node:test';
import assert from 'node:assert/strict';
import { success } from '../lib/success.js';
import { FAILURE_MARKER, LABEL_COLOR, MAX_IN_FLIGHT } from '../lib/definitions/constants.js';
import { resolveConfig } from '../lib/resolve-config.js';
import { recordingLogger } from './support/release-helpers.mjs';
import { apiError, routedClient } from './support/routed-client.mjs';

const TOKEN = 'tok-1234567890abcdef';
const R = '/repos/o/r';
const RELEASE_URL = 'https://git.example/o/r/releases/tag/v1.2.0';

/** The error type of the `aggregate-error` package: its `errors` hold the individual failures. @param {unknown} error */
const isAggregate = (error) => error instanceof Error && error.name === 'AggregateError';
/** @param {any} error */
const inner = (error) => [...error.errors].map(String);

/** @param {number} number @param {Record<string, unknown>} [more] */
const pull = (number, more = {}) => ({ number, body: '', state: 'closed', merged: true, merge_commit_sha: 'zzz', html_url: `https://git.example/o/r/pulls/${number}`, ...more });
/** @param {number} number @param {Record<string, unknown>} [more] */
const issueObject = (number, more = {}) => ({ number, body: '', state: 'open', html_url: `https://git.example/o/r/issues/${number}`, ...more });
/** @param {string} hash @param {string} [message] */
const commit = (hash, message = `chore: ${hash}`) => ({ hash, message });

/**
 * An in-memory Gitea. Answers 404 for anything the scenario does not list.
 * @param {{
 *   pullBySha?: Record<string, object>, pulls?: Record<number, object>, pullCommits?: Record<number, string[]>,
 *   issues?: Record<number, object>, failureIssues?: object[], labels?: Array<{ id: number, name: string }>,
 *   commentStatus?: Record<number, number>, lookupStatus?: Record<string, number>, labelCreateStatus?: number, closeStatus?: number,
 * }} [s]
 */
function gitea(s = {}) {
  const labels = s.labels ?? [];
  const server = routedClient(({ method, path, options }) => {
    let m;
    if (method === 'GET' && (m = /^\/repos\/o\/r\/commits\/(\w+)\/pull$/.exec(path))) {
      if (s.lookupStatus?.[m[1]]) throw apiError(s.lookupStatus[m[1]]);
      const found = s.pullBySha?.[m[1]];
      if (!found) throw apiError(404);
      return found;
    }
    if (method === 'GET' && (m = /^\/repos\/o\/r\/pulls\/(\d+)\/commits$/.exec(path))) return (s.pullCommits?.[Number(m[1])] ?? []).map((sha) => ({ sha }));
    if (method === 'GET' && (m = /^\/repos\/o\/r\/pulls\/(\d+)$/.exec(path))) {
      const found = s.pulls?.[Number(m[1])];
      if (!found) throw apiError(404);
      return found;
    }
    if (method === 'GET' && (m = /^\/repos\/o\/r\/issues\/(\d+)$/.exec(path))) {
      const found = s.issues?.[Number(m[1])];
      if (!found) throw apiError(404);
      return found;
    }
    if (method === 'GET' && path === `${R}/issues`) return s.failureIssues ?? [];
    if (method === 'PATCH' && (m = /^\/repos\/o\/r\/issues\/(\d+)$/.exec(path))) {
      if (s.closeStatus) throw apiError(s.closeStatus);
      return { html_url: `https://git.example/o/r/issues/${m[1]}` };
    }
    if (method === 'POST' && (m = /^\/repos\/o\/r\/issues\/(\d+)\/comments$/.exec(path))) {
      const status = s.commentStatus?.[Number(m[1])];
      if (status) throw apiError(status);
      return { html_url: `https://git.example/o/r/issues/${m[1]}#comment` };
    }
    if (method === 'POST' && /^\/repos\/o\/r\/issues\/\d+\/labels$/.test(path)) return [];
    if (method === 'GET' && path === `${R}/labels`) return labels;
    if (method === 'POST' && path === `${R}/labels`) {
      if (s.labelCreateStatus) throw apiError(s.labelCreateStatus);
      const label = { id: 300 + labels.length, name: options.json.name };
      labels.push(label);
      return label;
    }
    if (method === 'PATCH' && /^\/repos\/o\/r\/releases\/\d+$/.test(path)) return { html_url: RELEASE_URL };
    return assert.fail(`unexpected ${method} ${path}`);
  });
  return server;
}

/**
 * @param {{ config?: Record<string, unknown>, context?: Record<string, unknown>, server?: ReturnType<typeof gitea>, env?: Record<string, string> }} [overrides]
 */
function setup({ config = {}, context = {}, server = gitea(), env = { GITEA_TOKEN: TOKEN, GITEA_URL: 'https://git.example' } } = {}) {
  const { logger, lines: logged } = recordingLogger();
  const resolved = resolveConfig(/** @type {any} */ (config), { env });
  const verified = { config: resolved, client: server.client, owner: 'o', repo: 'r' };
  const full = /** @type {import('../index.js').Context} */ (
    /** @type {unknown} */ ({
      env: { GITEA_TOKEN: TOKEN },
      logger,
      options: { repositoryUrl: 'https://git.example/o/r.git' },
      branch: { name: 'main' },
      commits: [],
      nextRelease: { version: '1.2.0', gitTag: 'v1.2.0', channel: null, notes: 'Release notes', name: '1.2.0' },
      releases: [{ name: 'Gitea release', url: RELEASE_URL, id: 12 }],
      ...context,
    })
  );
  return { verified, context: full, server, logged };
}

/** @param {ReturnType<typeof gitea>} server @param {RegExp} path */
const posts = (server, path) => server.calls.filter((c) => c.method === 'POST' && path.test(c.path));
/** Numbers of the issues and pull requests that got a comment, sorted. @param {ReturnType<typeof gitea>} server */
const commented = (server) =>
  posts(server, /\/comments$/)
    .map((c) => Number(/issues\/(\d+)\/comments/.exec(c.path)?.[1]))
    .sort((a, b) => a - b);
/** @param {ReturnType<typeof gitea>} server */
const writes = (server) => server.calls.filter((c) => c.method !== 'GET');

// --- when it does nothing ---------------------------------------------------

for (const [name, config, context] of /** @type {const} */ ([
  ['successComment is false', { successComment: false }, { commits: [commit('a1')] }],
  ['successCommentCondition is false', { successCommentCondition: false }, { commits: [commit('a1')] }],
  ['there are no commits', {}, { commits: [] }],
])) {
  test(`when ${name} no pull request is looked up and nothing is commented or labelled`, async () => {
    const { verified, context: full, server, logged } = setup({ config, context });
    await success(verified, full);
    assert.equal(server.calls.filter((c) => /commits|pulls|labels|comments/.test(c.path) && c.path !== `${R}/issues`).length, 0);
    assert.ok(logged.some(([level, message]) => level === 'log' && /skip/i.test(String(message))), 'the log should say why');
  });
}

// --- finding pull requests ----------------------------------------------------

test('merge-commit, squash and rebase pull requests are each found from the commit the merge recorded', async () => {
  const server = gitea({ pullBySha: { m1: pull(1), s2: pull(2), r3: pull(3) } });
  const { verified, context } = setup({ server, context: { commits: [commit('b1'), commit('m1'), commit('s2'), commit('b2'), commit('r3')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [1, 2, 3]);
});

test('a commit with no pull request is ignored without an error', async () => {
  const { verified, context, server } = setup({ context: { commits: [commit('direct')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), []);
});

test('a (#N) at the end of a subject finds a merged pull request whose merge commit is in the release', async () => {
  const server = gitea({ pulls: { 9: pull(9, { merge_commit_sha: 'c9' }) } });
  const { verified, context } = setup({ server, context: { commits: [commit('c9', 'fix: handle empty list (#9)\n\nlonger text')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [9]);
});

test('a (#N) pull request also counts when one of its own commits is in the release', async () => {
  const server = gitea({ pulls: { 9: pull(9, { merge_commit_sha: 'elsewhere' }) }, pullCommits: { 9: ['x', 'c9'] } });
  const { verified, context } = setup({ server, context: { commits: [commit('c9', 'fix: a (#9)')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [9]);
});

test('a (#N) that is not a pull request is ignored and its issue is not fetched', async () => {
  const server = gitea({ issues: { 10: issueObject(10) } });
  const { verified, context } = setup({ server, context: { commits: [commit('c1', 'feat: thing (#10)')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), []);
  assert.equal(server.calls.filter((c) => c.path === `${R}/issues/10`).length, 0);
});

test('a (#N) pull request that is open, or whose commits are not in the release, is dropped', async () => {
  const server = gitea({
    pulls: { 11: pull(11, { merged: false, state: 'open', merge_commit_sha: null }), 12: pull(12, { merge_commit_sha: 'foreign' }) },
    pullCommits: { 12: ['other'] },
  });
  const { verified, context } = setup({ server, context: { commits: [commit('c1', 'a (#11)'), commit('c2', 'b (#12)')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), []);
});

test('a pull request found by the lookup is kept without the merge commit test', async () => {
  const server = gitea({ pullBySha: { r3: pull(3, { merge_commit_sha: null, merged: true }) } });
  const { verified, context } = setup({ server, context: { commits: [commit('r3')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [3]);
  assert.equal(server.calls.filter((c) => /pulls/.test(c.path)).length, 0, 'no extra pull request request');
});

test('one pull request found from several commits and a reference is commented once and fetched at most once', async () => {
  const server = gitea({ pullBySha: { a: pull(5), b: pull(5) }, pulls: { 5: pull(5) } });
  const { verified, context } = setup({ server, context: { commits: [commit('a', 'x (#5)'), commit('b', 'y (#5)'), commit('c', 'z (#5)')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [5]);
  assert.ok(server.calls.filter((c) => c.path === `${R}/pulls/5`).length <= 1);
});

test('a lookup that fails with a server error is collected, and the other pull requests are still commented', async () => {
  const server = gitea({ pullBySha: { ok: pull(2) }, lookupStatus: { bad: 500 } });
  const { verified, context } = setup({ server, context: { commits: [commit('bad'), commit('ok')] } });
  await assert.rejects(success(verified, context), (error) => isAggregate(error) && /status 500/.test(inner(error).join()));
  assert.deepEqual(commented(server), [2]);
});

// --- finding the issues a release closes --------------------------------------

test('issues named by closing keywords in pull request bodies and commit messages are commented once each', async () => {
  const server = gitea({
    pullBySha: { m1: pull(1, { body: 'Closes #12' }) },
    issues: { 12: issueObject(12), 14: issueObject(14) },
  });
  const messages = 'fix: x\n\nFixes #12\nCloses other/repo#3\nCloses #14';
  const { verified, context } = setup({ server, context: { commits: [commit('m1', messages)] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [1, 12, 14]);
  assert.equal(server.calls.filter((c) => c.path === `${R}/issues/12`).length, 1);
});

test('an issue that answers 404 is skipped with a log line and no error', async () => {
  const { verified, context, logged } = setup({ context: { commits: [commit('a', 'Closes #13')] } });
  await success(verified, context);
  assert.ok(logged.some(([, message, number]) => /13|not found|exist/i.test(String(message)) || number === 13));
});

test('a closing keyword that names a kept pull request does not fetch or comment twice', async () => {
  const server = gitea({ pullBySha: { m1: pull(1, { body: 'Closes #2' }), m2: pull(2) } });
  const { verified, context } = setup({ server, context: { commits: [commit('m1'), commit('m2')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [1, 2]);
  assert.equal(server.calls.filter((c) => c.path === `${R}/issues/2`).length, 0);
});

test('an issue address on the Gitea server counts, a pull request address and another repository do not', async () => {
  const server = gitea({ issues: { 5: issueObject(5), 6: issueObject(6) } });
  const text = 'Closes https://git.example/o/r/issues/5\nCloses https://git.example/o/r/pulls/6\nCloses https://git.example/x/y/issues/7\nCloses O/R#8';
  const { verified, context } = setup({ server, context: { commits: [commit('a', text)] } });
  await success(verified, context);
  assert.ok(commented(server).includes(5));
  assert.ok(!commented(server).includes(6));
  assert.ok(!commented(server).includes(7));
  assert.ok(server.calls.some((c) => c.path === `${R}/issues/8`), 'the repository name is compared without regard to case');
});

test('with only giteaApiUrl set, issue addresses on that server are still read', async () => {
  const server = gitea({ issues: { 5: issueObject(5) } });
  const { verified, context } = setup({
    server,
    config: { giteaApiUrl: 'https://git.example/api/v1' },
    env: { GITEA_TOKEN: TOKEN },
    context: { commits: [commit('a', 'Closes https://git.example/o/r/issues/5')] },
  });
  await success(verified, context);
  assert.deepEqual(commented(server), [5]);
});

test('a server under a sub-path is read through giteaUrl', async () => {
  const server = gitea({ issues: { 5: issueObject(5) } });
  const { verified, context } = setup({
    server,
    config: { giteaUrl: 'https://git.example/gitea' },
    context: { commits: [commit('a', 'Closes https://git.example/gitea/o/r/issues/5')] },
  });
  await success(verified, context);
  assert.deepEqual(commented(server), [5]);
});

// --- the comment --------------------------------------------------------------

test('the default comment says the pull request is included or the issue resolved, names the version and links the release', async () => {
  const server = gitea({ pullBySha: { m1: pull(1) }, issues: { 12: issueObject(12) } });
  const { verified, context } = setup({ server, context: { commits: [commit('m1', 'Closes #12')] } });
  await success(verified, context);
  const bodies = Object.fromEntries(posts(server, /\/comments$/).map((c) => [c.path, c.options.json.body]));
  assert.match(bodies[`${R}/issues/1/comments`], /PR is included in version 1\.2\.0/);
  assert.match(bodies[`${R}/issues/12/comments`], /issue has been resolved in version 1\.2\.0/);
  assert.ok(bodies[`${R}/issues/1/comments`].includes(`[Gitea release](${RELEASE_URL})`));
});

test('with several releases the default comment lists each one that has a name', async () => {
  const server = gitea({ pullBySha: { m1: pull(1) } });
  const releases = [{ name: 'Gitea release', url: RELEASE_URL }, { name: 'npm package', url: 'https://npm.example/p' }, { url: 'https://nameless.example' }];
  const { verified, context } = setup({ server, context: { commits: [commit('m1')], releases } });
  await success(verified, context);
  const body = posts(server, /\/comments$/)[0].options.json.body;
  assert.ok(body.includes('- [Gitea release]') && body.includes('- [npm package](https://npm.example/p)'));
  assert.equal(body.includes('nameless'), false);
});

test('successComment is rendered with the release context and the item', async () => {
  const server = gitea({ pullBySha: { m1: pull(1) } });
  const { verified, context } = setup({
    server,
    config: { successComment: '#<%= issue.number %> is in <%= nextRelease.version %>, pr: <%= Boolean(issue.pull_request) %>' },
    context: { commits: [commit('m1')] },
  });
  await success(verified, context);
  assert.equal(posts(server, /\/comments$/)[0].options.json.body, '#1 is in 1.2.0, pr: true');
});

test('a successCommentCondition that renders false skips that item with a log line', async () => {
  const server = gitea({ pullBySha: { m1: pull(1), m2: pull(2) } });
  const { verified, context, logged } = setup({
    server,
    config: { successCommentCondition: '<% return issue.number !== 1 %>' },
    context: { commits: [commit('m1'), commit('m2')] },
  });
  await success(verified, context);
  assert.deepEqual(commented(server), [2]);
  assert.ok(logged.some(([level, message]) => level === 'log' && /skip/i.test(String(message))));
});

test('a successComment that throws is collected for that item and the others are commented', async () => {
  const server = gitea({ pullBySha: { m1: pull(1), m2: pull(2) } });
  const { verified, context } = setup({
    server,
    config: { successComment: '<% if (issue.number === 1) { throw new Error("bad template"); } %>fine' },
    context: { commits: [commit('m1'), commit('m2')] },
  });
  await assert.rejects(success(verified, context), (error) => isAggregate(error) && /bad template/.test(inner(error).join()));
  assert.deepEqual(commented(server), [2]);
});

test('the token is hidden in what is posted', async () => {
  const server = gitea({ pullBySha: { m1: pull(1) } });
  const { verified, context } = setup({ server, config: { successComment: 'leak: <%= env.GITEA_TOKEN %>' }, context: { commits: [commit('m1')] } });
  await success(verified, context);
  assert.equal(JSON.stringify(posts(server, /\/comments$/)[0].options.json).includes(TOKEN), false);
});

// --- labels -------------------------------------------------------------------

test('released labels are created when missing and added by id after the comment', async () => {
  const server = gitea({ pullBySha: { m1: pull(1), m2: pull(2) } });
  const { verified, context } = setup({
    server,
    config: { releasedLabels: ['released<%= nextRelease.channel ? ` on @${nextRelease.channel}` : "" %>'] },
    context: { commits: [commit('m1'), commit('m2')], nextRelease: { version: '1.2.0', gitTag: 'v1.2.0', channel: 'next', notes: 'n' } },
  });
  await success(verified, context);
  const created = posts(server, /\/labels$/).filter((c) => c.path === `${R}/labels`);
  assert.deepEqual(created.map((c) => c.options.json), [{ name: 'released on @next', color: LABEL_COLOR }]);
  const added = posts(server, /issues\/\d+\/labels$/);
  assert.equal(added.length, 2);
  for (const call of added) {
    assert.deepEqual(call.options.json, { labels: [300] });
    const number = /issues\/(\d+)\//.exec(call.path)?.[1];
    assert.ok(server.calls.indexOf(call) > server.calls.findIndex((c) => c.path === `${R}/issues/${number}/comments`), 'after that item’s comment');
  }
  assert.equal(server.calls.filter((c) => c.method === 'GET' && c.path === `${R}/labels`).length, 1, 'labels are listed once for the whole run');
});

test('releasedLabels set to false adds no labels', async () => {
  const server = gitea({ pullBySha: { m1: pull(1) } });
  const { verified, context } = setup({ server, config: { releasedLabels: false }, context: { commits: [commit('m1')] } });
  await success(verified, context);
  assert.equal(server.calls.filter((c) => /labels/.test(c.path)).length, 0);
});

test('no label request is made when nothing is commented', async () => {
  const server = gitea({ pullBySha: { m1: pull(1) } });
  const { verified, context } = setup({ server, config: { successCommentCondition: '<% return false %>' }, context: { commits: [commit('m1')] } });
  await success(verified, context);
  assert.equal(server.calls.filter((c) => /labels/.test(c.path)).length, 0);
});

test('a label template that renders empty is skipped', async () => {
  const server = gitea({ pullBySha: { m1: pull(1) } });
  const { verified, context } = setup({ server, config: { releasedLabels: ['<%= "" %>', 'shipped'] }, context: { commits: [commit('m1')] } });
  await success(verified, context);
  assert.deepEqual(posts(server, /issues\/\d+\/labels$/)[0].options.json, { labels: [300] });
  assert.deepEqual(posts(server, /^\/repos\/o\/r\/labels$/).map((c) => c.options.json.name), ['shipped']);
});

test('an item whose comment failed gets no labels', async () => {
  const server = gitea({ pullBySha: { m1: pull(1), m2: pull(2) }, commentStatus: { 1: 500 } });
  const { verified, context } = setup({ server, context: { commits: [commit('m1'), commit('m2')] } });
  await assert.rejects(success(verified, context), isAggregate);
  assert.deepEqual(posts(server, /issues\/\d+\/labels$/).map((c) => c.path), [`${R}/issues/2/labels`]);
});

// --- errors -------------------------------------------------------------------

test('comments answering 201, 500 and 403 are all tried; the 403 is logged and only the 500 and a label failure are thrown', async () => {
  const server = gitea({ pullBySha: { a: pull(1), b: pull(2), c: pull(3) }, commentStatus: { 2: 500, 3: 403 }, labelCreateStatus: 403 });
  const { verified, context, logged } = setup({ server, context: { commits: [commit('a'), commit('b'), commit('c')] } });
  await assert.rejects(success(verified, context), (error) => {
    assert.ok(isAggregate(error));
    const messages = inner(error);
    assert.equal(messages.length, 2, messages.join(' | '));
    assert.ok(messages.some((m) => /status 500/.test(m)));
    assert.ok(messages.some((m) => /status 403/.test(m)));
    return true;
  });
  assert.equal(posts(server, /\/comments$/).length, 3);
  assert.ok(logged.some(([level]) => level === 'error'));
});

test('a 404 answer to a comment is logged and not thrown', async () => {
  const server = gitea({ pullBySha: { a: pull(1) }, commentStatus: { 1: 404 } });
  const { verified, context } = setup({ server, context: { commits: [commit('a')] } });
  await success(verified, context);
});

// --- closing failure issues ---------------------------------------------------

test('open failure issues are closed, and an issue with the label but no marker is left alone', async () => {
  const server = gitea({ failureIssues: [{ number: 4, body: FAILURE_MARKER }, { number: 6, body: FAILURE_MARKER }, { number: 5, body: 'a person wrote this' }] });
  const { verified, context } = setup({ server });
  await success(verified, context);
  const closed = server.calls.filter((c) => c.method === 'PATCH' && /issues\/\d+$/.test(c.path));
  assert.deepEqual(closed.map((c) => c.path), [`${R}/issues/4`, `${R}/issues/6`]);
  assert.deepEqual(closed[0].options.json, { state: 'closed' });
});

for (const option of /** @type {const} */ (['failCommentCondition', 'failComment', 'failTitle'])) {
  test(`with ${option} set to false no failure issue is listed or closed`, async () => {
    const server = gitea({ failureIssues: [{ number: 4, body: FAILURE_MARKER }] });
    const { verified, context } = setup({ server, config: { [option]: false } });
    await success(verified, context);
    assert.equal(server.calls.filter((c) => c.path === `${R}/issues`).length, 0);
    assert.equal(writes(server).length, 0);
  });
}

test('a failure to close an issue is collected and the other issues are still closed', async () => {
  const server = gitea({ failureIssues: [{ number: 4, body: FAILURE_MARKER }, { number: 6, body: FAILURE_MARKER }], closeStatus: 500 });
  const { verified, context } = setup({ server });
  await assert.rejects(success(verified, context), isAggregate);
  assert.equal(server.calls.filter((c) => c.method === 'PATCH').length, 2);
});

// --- addReleases --------------------------------------------------------------

const OTHER = { name: 'npm package', url: 'https://npm.example/p' };
const OWN = { name: 'Gitea release', url: RELEASE_URL, id: 12 };

for (const [position, expected] of /** @type {const} */ ([
  ['bottom', 'Release notes\n---\nThis release is also available on:\n- [npm package](https://npm.example/p)'],
  ['top', 'This release is also available on:\n- [npm package](https://npm.example/p)\n---\nRelease notes'],
])) {
  test(`addReleases ${position} sends the rendered body with the other releases listed`, async () => {
    const { verified, context, server } = setup({ config: { addReleases: position }, context: { releases: [OWN, OTHER] } });
    await success(verified, context);
    const patch = server.calls.find((c) => c.method === 'PATCH' && c.path === `${R}/releases/12`);
    assert.ok(patch, 'expected a release update');
    assert.equal(patch.options.json.body, expected);
  });
}

test('addReleases builds the body from releaseBodyTemplate, as publish does', async () => {
  const { verified, context, server } = setup({ config: { addReleases: 'bottom', releaseBodyTemplate: 'Custom <%= nextRelease.version %>' }, context: { releases: [OWN, OTHER] } });
  await success(verified, context);
  assert.ok(server.calls.find((c) => c.path === `${R}/releases/12`)?.options.json.body.startsWith('Custom 1.2.0\n---'));
});

for (const [name, config, ctx] of /** @type {const} */ ([
  ['an error was collected', { addReleases: 'bottom' }, { releases: [OWN, OTHER], commits: [commit('a')] }],
  ['the release has no id', { addReleases: 'bottom' }, { releases: [{ name: 'Gitea release', url: RELEASE_URL }, OTHER] }],
  ['there is no other release', { addReleases: 'bottom' }, { releases: [OWN] }],
  ['addReleases is false', { addReleases: false }, { releases: [OWN, OTHER] }],
])) {
  test(`addReleases does nothing when ${name}`, async () => {
    const server = gitea({ pullBySha: { a: pull(1) }, commentStatus: { 1: 500 } });
    const { verified, context } = setup({ server, config, context: ctx });
    await success(verified, context).catch(() => {});
    assert.equal(server.calls.filter((c) => c.path === `${R}/releases/12`).length, 0);
  });
}

// --- limits -------------------------------------------------------------------

test('forty commits that point at three pull requests are looked up once each, with at most five requests at once', async () => {
  const commits = Array.from({ length: 40 }, (_, n) => commit(`c${n}`, `change ${n} (#${(n % 3) + 1})`));
  const pullBySha = Object.fromEntries(commits.map(({ hash }, n) => [hash, pull((n % 3) + 1)]));
  const server = gitea({ pullBySha });
  const { verified, context } = setup({ server, context: { commits } });
  await success(verified, context);
  assert.equal(server.calls.filter((c) => /\/commits\/\w+\/pull$/.test(c.path)).length, 40);
  assert.deepEqual(commented(server), [1, 2, 3]);
  for (const n of [1, 2, 3]) assert.ok(server.calls.filter((c) => c.path === `${R}/pulls/${n}`).length <= 1);
  assert.ok(server.peak() <= MAX_IN_FLIGHT, `peak was ${server.peak()}`);
  assert.ok(server.peak() > 1, 'requests should overlap, or the limit is not being tested');
});

// --- fixes after review -------------------------------------------------------

test('a successCommentCondition written with <%= %> that renders the text false skips that item', async () => {
  const server = gitea({ pullBySha: { m1: pull(1), m2: pull(2) } });
  const { verified, context } = setup({ server, config: { successCommentCondition: '<%= issue.number !== 1 %>' }, context: { commits: [commit('m1'), commit('m2')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [2]);
});

test('a closing keyword for another repository or a pull request address fetches nothing', async () => {
  const server = gitea({ issues: { 5: issueObject(5) } });
  const text = 'Closes other/repo#3\nCloses https://git.example/x/y/issues/7\nCloses https://git.example/o/r/pulls/6\nCloses #5';
  const { verified, context } = setup({ server, context: { commits: [commit('a', text)] } });
  await success(verified, context);
  const fetched = server.calls.filter((c) => c.method === 'GET' && /\/issues\/\d+$/.test(c.path)).map((c) => c.path);
  assert.deepEqual(fetched, [`${R}/issues/5`]);
});

test('an issue that answers 404 is skipped with a log line that names its number', async () => {
  const { verified, context, logged } = setup({ context: { commits: [commit('a', 'Closes #13')] } });
  await success(verified, context);
  assert.ok(logged.some(([level, message, number]) => level === 'log' && /not found/.test(String(message)) && number === 13));
});

test('a 404 answer to a comment is logged as an error that names the number', async () => {
  const server = gitea({ pullBySha: { a: pull(1) }, commentStatus: { 1: 404 } });
  const { verified, context, logged } = setup({ server, context: { commits: [commit('a')] } });
  await success(verified, context);
  assert.ok(logged.some(([level, message, number]) => level === 'error' && /exist/.test(String(message)) && number === 1));
});

test('an unexpected error while finding issues is collected, and the failure issues are still closed', async () => {
  const server = gitea({ failureIssues: [{ number: 4, body: FAILURE_MARKER }] });
  const { verified, context } = setup({ server, context: { commits: [commit('a', /** @type {any} */ (5))] } });
  await assert.rejects(success(verified, context), isAggregate);
  assert.equal(server.calls.filter((c) => c.method === 'PATCH' && c.path === `${R}/issues/4`).length, 1);
});

test('an issue is commented under the number that was asked for, even if the answer lacks one', async () => {
  const server = gitea({ issues: { 12: { state: 'open' } } });
  const { verified, context } = setup({ server, context: { commits: [commit('a', 'Closes #12')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), [12]);
});

test('a pull request lookup that answers with nothing is ignored', async () => {
  const server = gitea({ pulls: { 9: /** @type {any} */ (null) } });
  const { verified, context } = setup({ server, context: { commits: [commit('a', 'x (#9)')] } });
  await success(verified, context);
  assert.deepEqual(commented(server), []);
});

test('the label names are cleaned of the token before they are created', async () => {
  const server = gitea({ pullBySha: { m1: pull(1) } });
  const { verified, context } = setup({ server, config: { releasedLabels: ['<%= env.GITEA_TOKEN %>-x'] }, context: { commits: [commit('m1')] } });
  await success(verified, context);
  const created = posts(server, /^\/repos\/o\/r\/labels$/).map((c) => c.options.json.name);
  assert.deepEqual(created, ['***-x']);
});
