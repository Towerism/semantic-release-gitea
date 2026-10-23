import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fail } from '../lib/fail.js';
import { FAILURE_MARKER, LABEL_COLOR } from '../lib/definitions/constants.js';
import { resolveConfig } from '../lib/resolve-config.js';
import { recordingLogger } from './support/release-helpers.mjs';
import { apiError, lines, routedClient } from './support/routed-client.mjs';

const TOKEN = 'tok-1234567890abcdef';
const ISSUES = '/repos/o/r/issues';
const LABELS = '/repos/o/r/labels';

/** @param {string} message @param {string} [details] */
const releaseError = (message, details) => Object.assign(new Error(message), details === undefined ? {} : { details });

/**
 * A Gitea with the given open issues and labels. Records nothing itself: read
 * `calls` from the client.
 * @param {{ issues?: Array<{ number: number, body: string }>, labels?: Array<{ id: number, name: string }>, failOn?: (call: import('./support/routed-client.mjs').RoutedCall) => void }} [state]
 */
function gitea({ issues = [], labels = [], failOn } = {}) {
  return routedClient((call) => {
    failOn?.(call);
    const { method, path, options } = call;
    if (method === 'GET' && path === ISSUES) return issues;
    if (method === 'GET' && path === LABELS) return labels;
    if (method === 'POST' && path === LABELS) {
      const label = { id: 200 + labels.length, name: options.json.name };
      labels.push(label);
      return label;
    }
    if (method === 'POST' && path === ISSUES) return { number: 50, html_url: 'https://git.example/o/r/issues/50' };
    if (method === 'POST' && /^\/repos\/o\/r\/issues\/\d+\/comments$/.test(path)) return { html_url: 'https://git.example/o/r/issues/1#c' };
    return assert.fail(`unexpected ${method} ${path}`);
  });
}

/**
 * @param {{ config?: Record<string, unknown>, context?: Record<string, unknown>, server?: ReturnType<typeof gitea> }} [overrides]
 */
function setup({ config = {}, context = {}, server = gitea() } = {}) {
  const { logger, lines: logged } = recordingLogger();
  const resolved = resolveConfig(/** @type {any} */ (config), { env: { GITEA_TOKEN: TOKEN, GITEA_URL: 'https://git.example' } });
  const verified = { config: resolved, client: server.client, owner: 'o', repo: 'r' };
  const full = /** @type {import('../index.js').Context} */ (
    /** @type {unknown} */ ({
      env: {},
      logger,
      options: { repositoryUrl: 'https://git.example/o/r.git' },
      branch: { name: 'main' },
      errors: [releaseError('The npm token is invalid', 'Set NPM_TOKEN.'), releaseError('A second problem')],
      ...context,
    })
  );
  return { verified, context: full, server, logged };
}

const posts = (/** @type {ReturnType<typeof gitea>} */ server, /** @type {string} */ path) => server.calls.filter((c) => c.method === 'POST' && c.path === path);

// --- opening the issue --------------------------------------------------------

test('with no failure issue it creates one with the title, label ids, assignees, the errors and the marker', async () => {
  const { verified, context, server } = setup({ config: { failTitle: 'Release broke', labels: ['ci'], assignees: ['alice'] } });
  await fail(verified, context);
  const [created] = posts(server, ISSUES);
  assert.equal(posts(server, ISSUES).length, 1);
  const body = created.options.json;
  assert.equal(body.title, 'Release broke');
  assert.deepEqual(body.assignees, ['alice']);
  assert.equal(body.labels.length, 2);
  assert.ok(body.body.includes('The npm token is invalid'));
  assert.ok(body.body.includes('Set NPM_TOKEN.'));
  assert.ok(body.body.includes('A second problem'));
  assert.ok(body.body.includes('`main`'));
  assert.ok(body.body.trimEnd().endsWith(FAILURE_MARKER), 'the marker is the last line');
  assert.match(body.body, /\n\n<!-- semantic-release:gitea -->$/);
});

test('the labels sent are the ids of the configured labels and the failure label, each created if missing', async () => {
  const server = gitea({ labels: [{ id: 7, name: 'ci' }] });
  const { verified, context } = setup({ config: { labels: ['ci', 'semantic-release'] }, server });
  await fail(verified, context);
  const created = posts(server, LABELS);
  assert.deepEqual(created.map((c) => c.options.json), [{ name: 'semantic-release', color: LABEL_COLOR }]);
  assert.deepEqual(posts(server, ISSUES)[0].options.json.labels, [7, 201]);
});

test('with labels set to false only the failure label is used', async () => {
  const server = gitea({ labels: [{ id: 3, name: 'semantic-release' }] });
  const { verified, context } = setup({ config: { labels: false }, server });
  await fail(verified, context);
  assert.deepEqual(posts(server, ISSUES)[0].options.json.labels, [3]);
});

test('no assignees option means no assignees field', async () => {
  const { verified, context, server } = setup();
  await fail(verified, context);
  assert.equal('assignees' in posts(server, ISSUES)[0].options.json, false);
});

test('the default title is used when failTitle is not set', async () => {
  const { verified, context, server } = setup();
  await fail(verified, context);
  assert.equal(posts(server, ISSUES)[0].options.json.title, 'The automated release is failing 🚨');
});

test('failComment is rendered with the branch and the errors, and the marker still follows it', async () => {
  const { verified, context, server } = setup({ config: { failComment: 'Branch <%= branch.name %> has <%= errors.length %> errors' } });
  await fail(verified, context);
  assert.equal(posts(server, ISSUES)[0].options.json.body, `Branch main has 2 errors\n\n${FAILURE_MARKER}`);
});

// --- commenting on an existing issue -----------------------------------------

test('with an open failure issue it comments on the lowest-numbered one and creates nothing', async () => {
  const server = gitea({ issues: [{ number: 9, body: `x\n${FAILURE_MARKER}` }, { number: 4, body: `y\n${FAILURE_MARKER}` }, { number: 2, body: 'person wrote this' }] });
  const { verified, context } = setup({ server });
  await fail(verified, context);
  assert.equal(posts(server, ISSUES).length, 0);
  const comments = posts(server, '/repos/o/r/issues/4/comments');
  assert.equal(comments.length, 1);
  assert.ok(comments[0].options.json.body.includes('The npm token is invalid'));
  assert.equal(comments[0].options.json.body.includes(FAILURE_MARKER), false, 'the marker belongs to the issue body only');
  assert.equal(posts(server, LABELS).length, 0);
});

// --- skipping -----------------------------------------------------------------

for (const option of /** @type {const} */ (['failComment', 'failTitle', 'failCommentCondition'])) {
  test(`${option}: false sends nothing and says so`, async () => {
    const { verified, context, server, logged } = setup({ config: { [option]: false } });
    await fail(verified, context);
    assert.equal(server.calls.length, 0);
    assert.ok(logged.some(([level, message]) => level === 'log' && /skip/i.test(String(message))));
  });
}

test('a failCommentCondition that renders false skips, and it sees the failure issue found', async () => {
  const server = gitea({ issues: [{ number: 4, body: FAILURE_MARKER }] });
  const { verified, context } = setup({ config: { failCommentCondition: '<% return issue.number !== 4 %>' }, server });
  await fail(verified, context);
  assert.equal(server.calls.filter(({ method }) => method === 'POST').length, 0);
});

test('a failCommentCondition gets issue undefined when there is no failure issue, and true lets it through', async () => {
  const { verified, context, server } = setup({ config: { failCommentCondition: '<% return issue === undefined %>' } });
  await fail(verified, context);
  assert.equal(posts(server, ISSUES).length, 1);
});

// --- templates that throw and options of the wrong type -----------------------

test('a failComment template that throws falls back to the default text and adds the template error', async () => {
  const { verified, context, server, logged } = setup({ config: { failComment: '<%= nothing.here %>' } });
  await fail(verified, context);
  const body = posts(server, ISSUES)[0].options.json.body;
  assert.ok(body.includes('The npm token is invalid'));
  assert.match(body, /failComment/);
  assert.match(body, /nothing/);
  assert.ok(logged.some(([level, , option]) => level === 'error' && option === 'failComment'));
});

test('a failCommentCondition that throws lets the issue through and puts the error in its text', async () => {
  const { verified, context, server } = setup({ config: { failCommentCondition: '<% return nothing.here %>' } });
  await fail(verified, context);
  const body = posts(server, ISSUES)[0].options.json.body;
  assert.match(body, /failCommentCondition/);
});

test('options of the wrong type are replaced by their defaults with a log line', async () => {
  const { verified, context, server, logged } = setup({ config: { labels: [5], failTitle: 42, assignees: [5] } });
  await fail(verified, context);
  const sent = posts(server, ISSUES)[0].options.json;
  assert.equal(sent.title, 'The automated release is failing 🚨');
  assert.equal('assignees' in sent, false);
  for (const option of ['labels', 'failTitle', 'assignees']) {
    assert.ok(logged.some(([, message, name]) => /default/i.test(String(message)) && name === option), `a log line should name ${option}`);
  }
});

// --- secrets ------------------------------------------------------------------

test('the token is hidden in the issue text even when a release error contains it', async () => {
  const { verified, context, server } = setup({ context: { errors: [releaseError(`git push to https://x:${TOKEN}@git.example failed`, `token ${TOKEN}`)] } });
  await fail(verified, context);
  assert.equal(JSON.stringify(posts(server, ISSUES)[0].options.json).includes(TOKEN), false);
});

test('the token is hidden in a comment on an existing issue', async () => {
  const server = gitea({ issues: [{ number: 4, body: FAILURE_MARKER }] });
  const { verified, context } = setup({ server, context: { errors: [releaseError(`bad ${TOKEN}`)] } });
  await fail(verified, context);
  assert.equal(JSON.stringify(posts(server, '/repos/o/r/issues/4/comments')[0].options.json).includes(TOKEN), false);
});

// --- Gitea refuses ------------------------------------------------------------

test('a refused issue is thrown with the server message and there is no retry without the assignee', async () => {
  const server = gitea({
    failOn: ({ method, path }) => {
      if (method === 'POST' && path === ISSUES) throw apiError(422, 'user alice cannot be assigned');
    },
  });
  const { verified, context } = setup({ config: { assignees: ['alice'] }, server });
  await assert.rejects(fail(verified, context), /cannot be assigned/);
  assert.equal(posts(server, ISSUES).length, 1);
});

test('a label permission error is thrown and no issue is opened', async () => {
  const server = gitea({
    failOn: ({ method, path }) => {
      if (method === 'POST' && path === LABELS) throw apiError(403, 'no label rights');
    },
  });
  const { verified, context } = setup({ server });
  await assert.rejects(fail(verified, context), /no label rights/);
  assert.equal(posts(server, ISSUES).length, 0);
});

test('requests go to the owner and repository that were passed in', async () => {
  const { verified, context, server } = setup();
  await fail(verified, context);
  assert.ok(lines(server.calls).every((line) => line.includes('/repos/o/r/')));
});
