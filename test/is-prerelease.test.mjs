import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrerelease } from '../lib/is-prerelease.js';

test('a release on the main branch is not a pre-release', () => {
  assert.equal(isPrerelease({ type: 'release', main: true }), false);
});

test('a release on a maintenance or other non-main release branch is a pre-release', () => {
  assert.equal(isPrerelease({ type: 'release', main: false }), true);
});

test('a prerelease branch is a pre-release, whether it is marked by type or by its identifier', () => {
  assert.equal(isPrerelease({ type: 'prerelease' }), true);
  assert.equal(isPrerelease({ prerelease: 'beta' }), true);
  assert.equal(isPrerelease({ prerelease: true }), true);
});

test('prerelease: false overrides everything else', () => {
  assert.equal(isPrerelease({ prerelease: false, type: 'release', main: false }), false);
  assert.equal(isPrerelease({ prerelease: false, type: 'prerelease' }), false);
});
