import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';

const workflowsDir = new URL('../.github/workflows/', import.meta.url);

/**
 * @param {string} name
 * @returns {Promise<{ text: string, doc: any }>}
 */
async function load(name) {
  const text = await readFile(new URL(name, workflowsDir), 'utf8');
  return { text, doc: parse(text) };
}

/**
 * @param {any} job
 * @returns {string[]}
 */
function runCommands(job) {
  return job.steps.map((/** @type {{ run?: string }} */ step) => step.run).filter(Boolean);
}

test('ci runs on pull requests and on pushes to main, with read-only permissions', async () => {
  const { doc } = await load('ci.yml');
  assert.deepEqual(Object.keys(doc.on).sort(), ['pull_request', 'push']);
  assert.deepEqual(doc.on.push.branches, ['main']);
  assert.deepEqual(doc.permissions, { contents: 'read' });
});

test('ci tests Node 22 and 24 only, and runs install, lint and test', async () => {
  const { doc } = await load('ci.yml');
  const jobs = Object.values(doc.jobs);
  assert.equal(jobs.length, 1);
  const job = /** @type {any} */ (jobs[0]);
  assert.deepEqual(job.strategy.matrix['node-version'].map(String), ['22', '24']);
  assert.deepEqual(runCommands(job), ['npm ci', 'npm run lint', 'npm test']);
});

test('ci uses no secrets', async () => {
  const { text } = await load('ci.yml');
  assert.doesNotMatch(text, /secrets\./);
});

test('every third-party action in every workflow is pinned to a 40-character commit SHA', async () => {
  const names = (await readdir(workflowsDir)).filter((name) => name.endsWith('.yml'));
  assert.ok(names.length >= 2, 'expected ci.yml and release.yml');
  for (const name of names) {
    const { text } = await load(name);
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(.+)$/gm)].map((m) => m[1]);
    assert.ok(uses.length > 0, `${name} should use at least one action`);
    for (const line of uses) {
      assert.match(line, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d/, `${name}: "${line}" must pin a SHA and name the version`);
    }
  }
});

test('release runs on pushes to main only, gated by the RELEASES_ENABLED variable', async () => {
  const { text, doc } = await load('release.yml');
  assert.deepEqual(Object.keys(doc.on), ['push']);
  assert.deepEqual(doc.on.push.branches, ['main']);
  assert.equal(doc.jobs.release.if, "vars.RELEASES_ENABLED == 'true'");
  assert.match(text.split('\n').slice(0, 8).join('\n'), /RELEASES_ENABLED/, 'a comment at the top should say how to enable releases');
});

test('release has its own lint and test jobs and the release job needs both', async () => {
  const { doc } = await load('release.yml');
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['lint', 'release', 'test']);
  assert.deepEqual([...doc.jobs.release.needs].sort(), ['lint', 'test']);
  assert.deepEqual(doc.jobs.lint.permissions, { contents: 'read' });
  assert.deepEqual(doc.jobs.test.permissions, { contents: 'read' });
  assert.ok(runCommands(doc.jobs.lint).includes('npm run lint'));
  assert.ok(runCommands(doc.jobs.test).includes('npm test'));
});

test('the release job has the narrow write permissions, full history, Node 24 and an npm version check', async () => {
  const { doc } = await load('release.yml');
  const job = doc.jobs.release;
  assert.deepEqual(job.permissions, {
    contents: 'write',
    issues: 'write',
    'pull-requests': 'write',
    'id-token': 'write',
  });
  const checkout = job.steps.find((/** @type {{ uses?: string }} */ step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 0);
  const setupNode = job.steps.find((/** @type {{ uses?: string }} */ step) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(String(setupNode.with['node-version']), '24');
  assert.equal(setupNode.with.cache, undefined, 'the job that can publish must not restore a shared cache');
  const commands = runCommands(job);
  assert.ok(commands.some((cmd) => cmd.includes('npm --version') && cmd.includes('11.5.1')), 'must check npm is at least 11.5.1');
  assert.ok(commands.includes('npx semantic-release'));
});

test('the release job turns on provenance and runs one at a time', async () => {
  const { doc } = await load('release.yml');
  const job = doc.jobs.release;
  const env = { ...doc.env, ...job.env, ...Object.assign({}, ...job.steps.map((/** @type {{ env?: object }} */ s) => s.env ?? {})) };
  assert.equal(String(env.NPM_CONFIG_PROVENANCE), 'true');
  assert.deepEqual(job.concurrency ?? doc.concurrency, { group: 'release', 'cancel-in-progress': false });
});

/**
 * The secrets a workflow file reads that it is not allowed to read: e2e.yml may read only
 * GITEA_E2E_TOKEN, and every other workflow may read only GITHUB_TOKEN.
 *
 * @param {string} name file name under .github/workflows
 * @param {string} text file contents
 * @returns {string[]}
 */
function unexpectedSecrets(name, text) {
  const allowed = name === 'e2e.yml' ? 'GITEA_E2E_TOKEN' : 'GITHUB_TOKEN';
  const named = [...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]).filter((secret) => secret !== allowed);
  // secrets['NAME'], toJSON(secrets) and a bare secrets would read secrets this check cannot name.
  const indirect = [...text.matchAll(/\bsecrets\b(?!\.\w)/g)].map(() => 'secrets (read without a plain name)');
  return [...named, ...indirect];
}

test('every workflow reads only the secret it is allowed to', async () => {
  const names = (await readdir(workflowsDir)).filter((name) => name.endsWith('.yml'));
  for (const name of names) {
    const { text } = await load(name);
    assert.deepEqual(unexpectedSecrets(name, text), [], `${name} reads a secret it should not`);
  }
});

test('the secrets check rejects another secret in ci.yml and accepts GITEA_E2E_TOKEN in e2e.yml only', async () => {
  const { text } = await load('ci.yml');
  assert.deepEqual(unexpectedSecrets('ci.yml', `${text}\n# \${{ secrets.OTHER }}`), ['OTHER']);
  assert.deepEqual(unexpectedSecrets('ci.yml', '${{ secrets.GITEA_E2E_TOKEN }}'), ['GITEA_E2E_TOKEN']);
  assert.deepEqual(unexpectedSecrets('e2e.yml', '${{ secrets.GITEA_E2E_TOKEN }}'), []);
  assert.deepEqual(unexpectedSecrets('e2e.yml', '${{ secrets.GITHUB_TOKEN }}'), ['GITHUB_TOKEN']);
  assert.deepEqual(unexpectedSecrets('release.yml', '${{ secrets.GITHUB_TOKEN }}'), []);
});

test('the secrets check also rejects ways of reading secrets that are not a plain secrets.NAME', () => {
  for (const text of ["${{ secrets['GITEA_E2E_TOKEN'] }}", '${{ toJSON(secrets) }}', '${{ secrets }}', '${{ secrets[matrix.name] }}']) {
    assert.notDeepEqual(unexpectedSecrets('e2e.yml', text), [], `e2e.yml should be rejected for: ${text}`);
    assert.notDeepEqual(unexpectedSecrets('ci.yml', text), [], `ci.yml should be rejected for: ${text}`);
  }
});

test('e2e runs on manual dispatch and on pushes to main, and never on pull requests', async () => {
  const { doc } = await load('e2e.yml');
  assert.deepEqual(Object.keys(doc.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(doc.on.push.branches, ['main']);
});

test('e2e has read-only permissions, one 10-minute job on Node 24, and runs one at a time without cancelling', async () => {
  const { doc } = await load('e2e.yml');
  assert.deepEqual(doc.permissions, { contents: 'read' });
  const jobs = Object.values(doc.jobs);
  assert.equal(jobs.length, 1);
  const job = /** @type {any} */ (jobs[0]);
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 10, 'timeout-minutes must be set to 10 or less');
  const setupNode = job.steps.find((/** @type {{ uses?: string }} */ step) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(String(setupNode.with['node-version']), '24');
  assert.deepEqual(doc.concurrency ?? job.concurrency, { group: 'e2e', 'cancel-in-progress': false });
});

test('e2e passes the variable and the secret to the test step only, and writes no URL or token literal', async () => {
  const { text, doc } = await load('e2e.yml');
  const job = /** @type {any} */ (Object.values(doc.jobs)[0]);
  assert.equal(doc.env, undefined, 'no workflow-level env');
  assert.equal(job.env, undefined, 'no job-level env');
  const withEnv = job.steps.filter((/** @type {{ env?: object }} */ step) => step.env);
  assert.equal(withEnv.length, 1);
  assert.equal(withEnv[0].run, 'node --test test/e2e.test.mjs');
  assert.deepEqual(withEnv[0].env, {
    GITEA_E2E_URL: '${{ vars.GITEA_E2E_URL }}',
    GITEA_E2E_TOKEN: '${{ secrets.GITEA_E2E_TOKEN }}',
    E2E_REQUIRED: 'true',
  });
  assert.doesNotMatch(text, /https?:\/\//);
  const withoutPins = text.split('\n').filter((line) => !/uses:/.test(line)).join('\n');
  assert.doesNotMatch(withoutPins, /[0-9a-f]{32,}/i, 'no token-like literal');
});

test('e2e installs with npm ci, runs only the e2e test file, uses no cache, and does not persist checkout credentials', async () => {
  const { text, doc } = await load('e2e.yml');
  const job = /** @type {any} */ (Object.values(doc.jobs)[0]);
  assert.deepEqual(runCommands(job), ['npm ci', 'node --test test/e2e.test.mjs']);
  assert.doesNotMatch(text, /^\s*cache:/m);
  const checkout = job.steps.find((/** @type {{ uses?: string }} */ step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false);
});

test('ci and release do not mention the end-to-end variables, and release still needs only lint and test', async () => {
  for (const name of ['ci.yml', 'release.yml']) {
    const { text } = await load(name);
    assert.doesNotMatch(text, /GITEA_E2E|E2E_REQUIRED/, `${name} must not use the e2e variables`);
  }
  const { doc } = await load('release.yml');
  assert.deepEqual([...doc.jobs.release.needs].sort(), ['lint', 'test']);
});

test('.releaserc.json lists the four plugins and releases from main only', async () => {
  const config = JSON.parse(await readFile(new URL('../.releaserc.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.branches, ['main']);
  assert.deepEqual(config.plugins, [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/npm',
    '@semantic-release/github',
  ]);
});
