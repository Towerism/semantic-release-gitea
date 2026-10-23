import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig } from '../lib/resolve-config.js';

/** @param {Record<string, string>} [env] */
const context = (env = {}) => /** @type {any} */ ({ env });

test('an option wins over its environment variable', () => {
  const config = resolveConfig({ giteaUrl: 'https://option.example', giteaApiPrefix: '/api/v9' }, context({ GITEA_URL: 'https://env.example', GITEA_PREFIX: '/api/v8' }));
  assert.equal(config.giteaUrl, 'https://option.example');
  assert.equal(config.giteaApiPrefix, '/api/v9');
});

test('the environment variables fill in what the options leave out', () => {
  const config = resolveConfig({}, context({ GITEA_URL: 'https://env.example', GITEA_PREFIX: '/api/v8' }));
  assert.equal(config.giteaUrl, 'https://env.example');
  assert.equal(config.giteaApiPrefix, '/api/v8');
});

test('the API prefix defaults to /api/v1 and there is no default server', () => {
  const config = resolveConfig({}, context());
  assert.equal(config.giteaApiPrefix, '/api/v1');
  assert.equal(config.giteaUrl, undefined);
  assert.equal(config.apiBase, '');
});

test('the token comes only from GITEA_TOKEN', () => {
  const env = { GITEA_TOKEN: 'from-gitea', GH_TOKEN: 'from-gh', GITHUB_TOKEN: 'from-github' };
  const withTokenOption = /** @type {any} */ ({ giteaToken: 'from-option' });
  assert.equal(resolveConfig(withTokenOption, context(env)).giteaToken, 'from-gitea');
  assert.equal(resolveConfig(withTokenOption, context({ GH_TOKEN: 'x', GITHUB_TOKEN: 'y' })).giteaToken, undefined);
});

test('the API base is the server URL plus the prefix, without doubled or trailing slashes', () => {
  assert.equal(resolveConfig({ giteaUrl: 'https://git.example/gitea/' }, context()).apiBase, 'https://git.example/gitea/api/v1');
  assert.equal(resolveConfig({ giteaUrl: 'https://git.example', giteaApiPrefix: 'api/v1/' }, context()).apiBase, 'https://git.example/api/v1');
  assert.equal(resolveConfig({ giteaUrl: 'http://localhost:3000' }, context()).apiBase, 'http://localhost:3000/api/v1');
});

test('giteaApiUrl replaces the whole API base', () => {
  const config = resolveConfig({ giteaUrl: 'https://git.example', giteaApiUrl: 'https://api.example/v2/' }, context());
  assert.equal(config.apiBase, 'https://api.example/v2');
});

test('giteaApiUrl has no environment variable', () => {
  assert.equal(resolveConfig({}, context({ GITEA_API_URL: 'https://api.example', GITHUB_API_URL: 'https://api.example' })).giteaApiUrl, undefined);
});

test('the other options get the GitHub plugin defaults', () => {
  const config = resolveConfig({}, context());
  assert.equal(config.failTitle, 'The automated release is failing 🚨');
  assert.deepEqual(config.labels, ['semantic-release']);
  assert.deepEqual(config.releasedLabels, ['released<%= nextRelease.channel ? ` on @${nextRelease.channel}` : "" %>']);
  assert.equal(config.addReleases, false);
  assert.equal(config.draftRelease, false);
  assert.equal(config.releaseBodyTemplate, '<%= nextRelease.notes %>');
  assert.equal(config.releaseNameTemplate, '<%= nextRelease.name %>');
  assert.equal(config.discussionCategoryName, false);
  assert.equal(config.proxy, false);
});

test('false turns off the options that can be turned off, and explicit values are kept', () => {
  const config = resolveConfig({ labels: false, releasedLabels: false, failTitle: 'custom', draftRelease: true, addReleases: 'top' }, context());
  assert.equal(config.labels, false);
  assert.equal(config.releasedLabels, false);
  assert.equal(config.failTitle, 'custom');
  assert.equal(config.draftRelease, true);
  assert.equal(config.addReleases, 'top');
});

test('a single string becomes a one-item array for list options', () => {
  const config = resolveConfig({ assets: 'dist/*.tgz', labels: 'bug', assignees: 'me', releasedLabels: 'shipped' }, context());
  assert.deepEqual(config.assets, ['dist/*.tgz']);
  assert.deepEqual(config.labels, ['bug']);
  assert.deepEqual(config.assignees, ['me']);
  assert.deepEqual(config.releasedLabels, ['shipped']);
});

test('the proxy defaults to http_proxy, then HTTP_PROXY, then false, and an option wins', () => {
  assert.equal(resolveConfig({}, context({ http_proxy: 'http://lower:1', HTTP_PROXY: 'http://upper:1' })).proxy, 'http://lower:1');
  assert.equal(resolveConfig({}, context({ HTTP_PROXY: 'http://upper:1' })).proxy, 'http://upper:1');
  assert.equal(resolveConfig({ proxy: false }, context({ HTTP_PROXY: 'http://upper:1' })).proxy, false);
  assert.equal(resolveConfig({ proxy: 'http://option:1' }, context({ HTTP_PROXY: 'http://upper:1' })).proxy, 'http://option:1');
});

test('options that are not strings do not break the API base', () => {
  assert.equal(resolveConfig({ giteaUrl: /** @type {any} */ (42) }, context()).apiBase, '');
  assert.equal(resolveConfig({ giteaUrl: 'https://git.example', giteaApiPrefix: /** @type {any} */ (5) }, context()).apiBase, '');
});
