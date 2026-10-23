import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../lib/connect.js';
import { apiError } from './support/routed-client.mjs';

const TOKEN = 'tok-1234567890abcdef';

/**
 * @param {{ env?: Record<string, string>, repositoryUrl?: string, answer?: (path: string) => unknown }} [overrides]
 */
function setup({ env = { GITEA_TOKEN: TOKEN, GITEA_URL: 'https://git.example' }, repositoryUrl = 'https://git.example/o/r.git', answer = () => ({ full_name: 'o/r' }) } = {}) {
  /** @type {string[]} */
  const paths = [];
  /** @type {any[]} */
  const created = [];
  const createClient = (/** @type {any} */ options) => {
    created.push(options);
    return /** @type {import('../lib/client.js').GiteaClient} */ ({
      request: async (/** @type {string} */ method, /** @type {string} */ path) => {
        paths.push(`${method} ${path}`);
        return answer(path);
      },
      paginate: async () => [],
    });
  };
  const context = /** @type {import('../index.js').Context} */ (/** @type {unknown} */ ({ env, options: { repositoryUrl }, logger: { log() {}, warn() {}, error() {} } }));
  return { paths, created, context, createClient };
}

/** @param {Promise<unknown>} promise @returns {Promise<string[]>} the error codes */
async function codes(promise) {
  try {
    await promise;
  } catch (error) {
    return [.../** @type {any} */ (error).errors].map((e) => e.code);
  }
  return assert.fail('expected an error');
}

test('it reads the repository once and returns the owner and name the server reports', async () => {
  const { paths, context, createClient, created } = setup({ answer: () => ({ full_name: 'new-owner/new-name' }) });
  const result = await connect({}, context, { createClient });
  assert.deepEqual(paths, ['GET /repos/o/r']);
  assert.equal(result.owner, 'new-owner');
  assert.equal(result.repo, 'new-name');
  assert.equal(created[0].apiBase, 'https://git.example/api/v1');
  assert.equal(created[0].token, TOKEN);
});

test('it does not read the server version or check the permissions that verification checks', async () => {
  const { paths, context, createClient } = setup({ answer: () => ({ full_name: 'o/r', permissions: { push: false } }) });
  await connect(/** @type {any} */ ({ discussionCategoryName: 'Releases', assets: 42 }), context, { createClient });
  assert.deepEqual(paths, ['GET /repos/o/r']);
});

test('a full_name it cannot read falls back to the owner and name in repositoryUrl', async () => {
  const { context, createClient } = setup({ answer: () => ({ full_name: 7 }) });
  const result = await connect({}, context, { createClient });
  assert.deepEqual([result.owner, result.repo], ['o', 'r']);
});

test('a missing token throws ENOGITEATOKEN before any request', async () => {
  const { paths, context, createClient } = setup({ env: { GITEA_URL: 'https://git.example' } });
  assert.deepEqual(await codes(connect({}, context, { createClient })), ['ENOGITEATOKEN']);
  assert.equal(paths.length, 0);
});

test('a missing or unusable server address throws EINVALIDGITEAURL', async () => {
  const missing = setup({ env: { GITEA_TOKEN: TOKEN } });
  assert.deepEqual(await codes(connect({}, missing.context, { createClient: missing.createClient })), ['EINVALIDGITEAURL']);
  const broken = setup({ env: { GITEA_TOKEN: TOKEN } });
  assert.deepEqual(await codes(connect({ giteaUrl: 'not a url' }, broken.context, { createClient: broken.createClient })), ['EINVALIDGITEAURL']);
});

test('a repository URL without an owner and name throws EINVALIDGITEAURL', async () => {
  const { context, createClient } = setup({ repositoryUrl: 'https://git.example/' });
  assert.deepEqual(await codes(connect({}, context, { createClient })), ['EINVALIDGITEAURL']);
});

test('every missing piece is reported together', async () => {
  const { context, createClient } = setup({ env: {}, repositoryUrl: 'nonsense' });
  assert.deepEqual((await codes(connect({}, context, { createClient }))).sort(), ['EINVALIDGITEAURL', 'EINVALIDGITEAURL', 'ENOGITEATOKEN']);
});

test('a server that refuses the repository read is thrown as it is', async () => {
  const { context, createClient } = setup({
    answer: () => {
      throw apiError(404);
    },
  });
  await assert.rejects(connect({}, context, { createClient }), /status 404/);
});

test('a proxy of the wrong type is ignored', async () => {
  const { context, createClient, created } = setup();
  await connect(/** @type {any} */ ({ proxy: 5 }), context, { createClient });
  assert.equal(created[0].proxy, false);
});
