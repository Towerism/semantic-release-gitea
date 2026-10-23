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

test('the only secret any workflow reads is GITHUB_TOKEN', async () => {
  const names = (await readdir(workflowsDir)).filter((name) => name.endsWith('.yml'));
  for (const name of names) {
    const { text } = await load(name);
    const secrets = [...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
    for (const secret of secrets) {
      assert.equal(secret, 'GITHUB_TOKEN', `${name} reads secrets.${secret}`);
    }
  }
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
