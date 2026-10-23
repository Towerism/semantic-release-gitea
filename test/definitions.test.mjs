import { test } from 'node:test';
import assert from 'node:assert/strict';
import SemanticReleaseError from '@semantic-release/error';
import { getError } from '../lib/definitions/errors.js';
import { MIN_GITEA_VERSION } from '../lib/definitions/constants.js';

const TOKEN = 'tok-1234567890abcdef';
const PROXY = 'http://user:hunter2@proxy.example:3128';

/** @type {Array<[string, Record<string, unknown>]>} */
const CASES = [
  ['EINVALIDLABELS', { option: 'labels', value: PROXY }],
  ['EINVALIDPROXY', { option: 'proxy', value: PROXY }],
  ['EINVALIDGITEAAPIPREFIX', { option: 'giteaApiPrefix', value: 5 }],
  ['EINVALIDGITEAURL', { problem: 'missing' }],
  ['EINVALIDGITEAURL', { problem: 'option', option: 'giteaUrl', value: PROXY }],
  ['EINVALIDGITEAURL', { problem: 'repository-url', value: 'nonsense' }],
  ['ENOGITEATOKEN', {}],
  ['EINVALIDGITEATOKEN', { owner: 'o', repo: 'r' }],
  ['EMISSINGREPO', { owner: 'o', repo: 'r' }],
  ['EGITEANOPERMISSION', { owner: 'o', repo: 'r' }],
  ['EMISMATCHGITEAURL', { repositoryUrl: PROXY, clone_url: 'https://git.example/x/y.git' }],
  ['EUNSUPPORTEDOPTION', { option: 'discussionCategoryName' }],
  ['EUNSUPPORTEDGITEAVERSION', { version: '28.1.0' }],
  ['EMISSINGPROXYPACKAGE', { proxy: PROXY }],
];

for (const [code, context] of CASES) {
  test(`getError(${code}) gives a SemanticReleaseError with a message and details, and no secrets`, () => {
    const error = getError(code, { ...context, token: TOKEN });
    assert.ok(error instanceof SemanticReleaseError);
    assert.equal(error.code, code);
    assert.ok(error.message.length > 10, 'message should explain the problem');
    assert.ok(error.details.length > 20, 'details should explain the fix');
    for (const text of [error.message, error.details]) {
      assert.ok(!text.includes(TOKEN), 'the token must not be printed');
      assert.ok(!text.includes('hunter2'), 'URL credentials must not be printed');
    }
  });
}

test('an invalid-option error names the option', () => {
  const error = getError('EINVALIDLABELS', { option: 'labels', value: 3 });
  assert.match(error.message, /labels/);
});

test('an unsupported-option error names the option', () => {
  assert.match(getError('EUNSUPPORTEDOPTION', { option: 'discussionCategoryName' }).message, /discussionCategoryName/);
  assert.match(getError('EUNSUPPORTEDOPTION', { option: 'giteaToken' }).details, /GITEA_TOKEN/);
});

test('the version error names the minimum version', () => {
  assert.match(
    getError('EUNSUPPORTEDGITEAVERSION', { version: '28.1.0' }).message,
    new RegExp(MIN_GITEA_VERSION.replaceAll('.', '\\.')),
  );
});

test('an unknown code is a programming error', () => {
  assert.throws(() => getError('ENOSUCHCODE', {}), /ENOSUCHCODE/);
});
