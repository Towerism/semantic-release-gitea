import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { run } from '../../scripts/lib/run.mjs';
import { fakeGitea } from './support/fake-gitea.mjs';

const TOKEN = 'tok_0123456789abcdef0123456789abcdef01234567';
const NOW = 1_800_000_000_000;
const HOUR = 3600 * 1000;
const noSleep = async () => {};

const execute = async (srv, extra = {}) => {
  const lines = [];
  const outcome = await run({
    env: { GITEA_E2E_URL: srv.url, GITEA_E2E_TOKEN: TOKEN },
    now: () => NOW,
    sleep: noSleep,
    log: (line) => lines.push(line),
    ...extra,
  });
  return { ...outcome, output: lines.join('\n') };
};

test('records a result for each check the script owns, and exits 0', async () => {
  const srv = await fakeGitea();
  const { exitCode, results } = await execute(srv);
  await srv.close();
  assert.equal(exitCode, 0);
  assert.deepEqual(results.map((r) => r.check).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 9, 10]);
});

test('records check 7 as not run when no pull request could be created', async () => {
  const srv = await fakeGitea();
  const { results } = await execute(srv);
  await srv.close();
  const seven = results.find((r) => r.check === 7);
  assert.match(seven.note, /no pull request/);
});

test('check 10 is not run by the script and never fails the exit code', async () => {
  const srv = await fakeGitea();
  const { exitCode, results } = await execute(srv);
  await srv.close();
  assert.equal(exitCode, 0);
  assert.match(results.find((r) => r.check === 10).note, /workflow/);
});

test('imports nothing outside node built-ins and its own lib', () => {
  for (const file of ['gitea-api-spike.mjs', 'lib/run.mjs', 'lib/client.mjs', 'lib/guard.mjs', 'lib/scrub.mjs']) {
    const source = readFileSync(new URL(`../../scripts/${file}`, import.meta.url), 'utf8');
    for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
      assert.ok(specifier.startsWith('node:') || specifier.startsWith('./'), `${file} imports ${specifier}`);
    }
  }
});

test('exits 2 and sends no request when a variable is missing', () => {
  for (const missing of ['GITEA_E2E_URL', 'GITEA_E2E_TOKEN']) {
    const env = { PATH: process.env.PATH, GITEA_E2E_URL: 'http://127.0.0.1:1', GITEA_E2E_TOKEN: TOKEN };
    delete env[missing];
    const result = spawnSync(process.execPath, [new URL('../../scripts/gitea-api-spike.mjs', import.meta.url).pathname], { env, encoding: 'utf8' });
    assert.equal(result.status, 2, missing);
    assert.match(result.stderr, new RegExp(missing));
    assert.ok(!result.stderr.includes(TOKEN) && !result.stdout.includes(TOKEN));
  }
});

test('exits 2 for a plain http URL on a non-local host, before any request', async () => {
  const outcome = await run({
    env: { GITEA_E2E_URL: 'http://gitea.test.invalid', GITEA_E2E_TOKEN: TOKEN },
    now: () => NOW,
    sleep: noSleep,
    log: () => {},
  });
  assert.equal(outcome.exitCode, 2);
});

test('creates a repository named sr-e2e-<timestamp> and deletes it', async () => {
  const srv = await fakeGitea();
  await execute(srv);
  const left = srv.repoNames();
  const created = srv.created;
  await srv.close();
  assert.deepEqual(created, [`sr-e2e-${NOW}`]);
  assert.deepEqual(left, []);
});

test('exits 2 and creates nothing when the token is not the testing user', async () => {
  const srv = await fakeGitea({ login: 'admin' });
  const { exitCode } = await execute(srv);
  const methods = srv.requests.map((r) => `${r.method} ${r.path}`);
  await srv.close();
  assert.equal(exitCode, 2);
  assert.deepEqual(methods, ['GET /api/v1/user']);
});

test('keeps running the other checks and still cleans up when one check fails', async () => {
  const srv = await fakeGitea({ failOn: '/version' });
  const { exitCode, results } = await execute(srv);
  const left = srv.repoNames();
  await srv.close();
  assert.equal(exitCode, 0);
  assert.equal(results.find((r) => r.check === 1).observed.status, 500);
  assert.ok(results.some((r) => r.check === 2));
  assert.deepEqual(left, []);
});

test('deletes only stale sr-e2e repositories left by a crashed run', async () => {
  const stale = `sr-e2e-${NOW - 2 * HOUR}`;
  const srv = await fakeGitea({
    repos: [stale, 'sr-e2e-other', 'keep'].map((name) => ({ name, owner: { login: 'testing' } })),
  });
  await execute(srv);
  const deleted = srv.requests.filter((r) => r.method === 'DELETE').map((r) => r.path.split('/').pop());
  const left = srv.repoNames();
  await srv.close();
  assert.ok(deleted.includes(stale));
  assert.ok(!deleted.includes('sr-e2e-other') && !deleted.includes('keep'));
  assert.deepEqual(left.sort(), ['keep', 'sr-e2e-other']);
});

test('prints no token and no hostname', async () => {
  const srv = await fakeGitea();
  const { output } = await execute(srv);
  await srv.close();
  assert.ok(!output.includes(TOKEN));
  assert.ok(!output.includes('127.0.0.1'));
  assert.ok(!output.includes('gitea.test.invalid'));
});

test('exits 1 and names the repository when cleanup fails', async () => {
  const srv = await fakeGitea({ failDelete: true });
  const { exitCode, output } = await execute(srv);
  await srv.close();
  assert.equal(exitCode, 1);
  assert.match(output, new RegExp(`sr-e2e-${NOW}`));
});
