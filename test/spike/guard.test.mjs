import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBaseUrl, staleRepos } from '../../scripts/lib/guard.mjs';

test('accepts an https URL', () => {
  assert.equal(checkBaseUrl('https://gitea.test.invalid').hostname, 'gitea.test.invalid');
});

test('accepts http only for localhost', () => {
  assert.equal(checkBaseUrl('http://localhost:3000').hostname, 'localhost');
  assert.equal(checkBaseUrl('http://127.0.0.1:3000').hostname, '127.0.0.1');
});

test('rejects http for any other host, and non-URLs', () => {
  assert.throws(() => checkBaseUrl('http://gitea.test.invalid'), /https/);
  assert.throws(() => checkBaseUrl('not a url'), /URL/);
  assert.throws(() => checkBaseUrl('ftp://gitea.test.invalid'), /https/);
});

const HOUR = 3600 * 1000;
const NOW = 1_800_000_000_000;
const repo = (name, owner = 'testing') => ({ name, owner: { login: owner } });

test('selects only old sr-e2e-<digits> repositories owned by testing', () => {
  const repos = [
    repo(`sr-e2e-${NOW - 2 * HOUR}`),
    repo(`sr-e2e-${NOW - HOUR - 1}`),
    repo(`sr-e2e-${NOW - HOUR + 1}`),
    repo(`sr-e2e-${NOW}`),
    repo('sr-e2e-other'),
    repo('sr-e2e-123abc'),
    repo('keep'),
    repo(`sr-e2e-${NOW - 2 * HOUR}`, 'someone-else'),
    repo(`x-sr-e2e-${NOW - 2 * HOUR}`),
  ];
  assert.deepEqual(staleRepos(repos, NOW), [
    `sr-e2e-${NOW - 2 * HOUR}`,
    `sr-e2e-${NOW - HOUR - 1}`,
  ]);
});

test('selects nothing from an empty list', () => {
  assert.deepEqual(staleRepos([], NOW), []);
});
