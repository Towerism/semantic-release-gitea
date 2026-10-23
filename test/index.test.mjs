import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as plugin from '../index.js';
import { fixture, serve } from './support/server.mjs';

const LIFECYCLE = ['addChannel', 'fail', 'publish', 'success', 'verifyConditions'];
const NOT_YET = ['addChannel', 'fail', 'publish', 'success'];
const TOKEN = 'tok-1234567890abcdef';

test('index.js exports exactly the five lifecycle functions', () => {
  assert.deepEqual(Object.keys(plugin).sort(), LIFECYCLE);
});

test('the four steps that are not built yet return a promise that rejects as not implemented', async () => {
  const functions = /** @type {Record<string, (a: object, b: object) => Promise<unknown>>} */ (
    /** @type {unknown} */ (plugin)
  );
  for (const name of NOT_YET) {
    const result = functions[name]({}, {});
    assert.ok(result instanceof Promise, `${name} must be async, not throw synchronously`);
    await assert.rejects(result, /not implemented/i, `${name} should say it is not implemented`);
  }
});

test('index.d.ts declares the same names as index.js exports, and no others', async () => {
  const declaration = await readFile(new URL('../index.d.ts', import.meta.url), 'utf8');
  const declared = [...declaration.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(declared, LIFECYCLE);
  const valueExports = declaration
    .split('\n')
    .filter((line) => line.startsWith('export') && !/^export (interface|type) /.test(line));
  assert.equal(valueExports.length, LIFECYCLE.length, 'index.d.ts must export no values other than the functions');
});

test('index.d.ts types the options and the context instead of object', async () => {
  const declaration = await readFile(new URL('../index.d.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(declaration, /:\s*object\b/);
  assert.match(declaration, /interface PluginConfig/);
  assert.match(declaration, /interface Context/);
  assert.doesNotMatch(declaration, /giteaToken/, 'the token is not an option');
});

// --- verifyConditions against a local server ------------------------------

/** Answers /version and the repository like a healthy Gitea, and counts requests per path. */
async function giteaServer(/** @type {(path: string) => import('./support/server.mjs').Fixture | undefined} */ override = () => undefined) {
  /** @type {string[]} */
  const paths = [];
  const server = await serve([
    (req, res) => {
      const path = String(req.url);
      paths.push(path);
      const answer = override(path) ?? (path === '/api/v1/version' ? fixture('version') : path === '/api/v1/repos/owner/repo' ? fixture('repo') : fixture('not-found'));
      res.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    },
  ]);
  return { server, paths };
}

/** @param {string} url @param {Record<string, string>} [env] */
function contextFor(url, env = {}) {
  /** @type {string[]} */
  const logged = [];
  return {
    logged,
    context: /** @type {import('../index.js').Context} */ (/** @type {unknown} */ ({
      env: { GITEA_TOKEN: TOKEN, GITEA_URL: url, ...env },
      options: { repositoryUrl: `${url}/owner/repo.git` },
      logger: { log: (/** @type {string} */ message, /** @type {unknown[]} */ ...values) => void logged.push([message, ...values].join(' ')) },
    })),
  };
}

test('verifyConditions passes on a valid setup with exactly two requests, and logs the API address once', async () => {
  const { server, paths } = await giteaServer();
  try {
    const { context, logged } = contextFor(server.url);
    await plugin.verifyConditions({}, context);
    assert.deepEqual(paths, ['/api/v1/version', '/api/v1/repos/owner/repo']);
    assert.equal(server.requests[0].headers.authorization, `token ${TOKEN}`);
    assert.deepEqual(logged, [`Verify Gitea authentication (%s) ${server.url}/api/v1`]);
  } finally {
    await server.close();
  }
});

test('verifying the same setup again, with the original config object, makes no requests', async () => {
  const { server, paths } = await giteaServer();
  try {
    const { context } = contextFor(server.url);
    const pluginConfig = { labels: ['release'] };
    const before = structuredClone(pluginConfig);
    await plugin.verifyConditions(pluginConfig, context);
    await plugin.verifyConditions(pluginConfig, context);
    assert.equal(paths.length, 2);
    assert.deepEqual(pluginConfig, before, 'the config semantic-release passed in is not changed');
  } finally {
    await server.close();
  }
});

test('a different config is verified on its own', async () => {
  const { server, paths } = await giteaServer();
  try {
    const { context } = contextFor(server.url);
    await plugin.verifyConditions({ labels: ['a'] }, context);
    await plugin.verifyConditions({ labels: ['b'] }, context);
    assert.equal(paths.length, 4);
  } finally {
    await server.close();
  }
});

test('two calls at the same time share one verification', async () => {
  const { server, paths } = await giteaServer();
  try {
    const { context } = contextFor(server.url);
    await Promise.all([plugin.verifyConditions({}, context), plugin.verifyConditions({}, context)]);
    assert.equal(paths.length, 2);
  } finally {
    await server.close();
  }
});

test('a failed verification is not remembered, so the next call checks again', async () => {
  let version = '27.0.0';
  const { server, paths } = await giteaServer((path) => (path === '/api/v1/version' ? { ...fixture('version'), body: { version } } : undefined));
  try {
    const { context } = contextFor(server.url);
    await assert.rejects(plugin.verifyConditions({}, context), (/** @type {any} */ error) => error.errors[0].code === 'EUNSUPPORTEDGITEAVERSION');
    version = '28.2.0';
    await plugin.verifyConditions({}, context);
    assert.equal(paths.filter((p) => p === '/api/v1/version').length, 2);
  } finally {
    await server.close();
  }
});

test('a bad token is reported as EINVALIDGITEATOKEN before any release step', async () => {
  const { server } = await giteaServer(() => fixture('unauthorized'));
  try {
    const { context } = contextFor(server.url);
    await assert.rejects(plugin.verifyConditions({}, context), (/** @type {any} */ error) => {
      assert.deepEqual([...error.errors].map((e) => e.code), ['EINVALIDGITEATOKEN']);
      assert.ok(!String(error.message).includes(TOKEN));
      return true;
    });
  } finally {
    await server.close();
  }
});

// --- options on the publish entry -----------------------------------------

test('options on this plugin\'s entry in the legacy publish option are checked too', async () => {
  const { server } = await giteaServer();
  try {
    const { context } = contextFor(server.url);
    context.options.publish = /** @type {any} */ ([{ path: '@semantic-release/npm', assets: 'ignored' }, { path: 'semantic-release-gitea', assets: [5] }]);
    await assert.rejects(plugin.verifyConditions({}, context), (/** @type {any} */ error) => [...error.errors].some((e) => e.code === 'EINVALIDASSETS'));
  } finally {
    await server.close();
  }
});

test('the plugin\'s own value wins over the publish entry, and other plugins\' entries are ignored', async () => {
  const { server } = await giteaServer();
  try {
    const { context } = contextFor(server.url);
    context.options.publish = /** @type {any} */ ([{ path: 'semantic-release-gitea', labels: [5], discussionCategoryName: 'Releases' }, { path: 'other-plugin', assets: [5] }]);
    /** @type {import('../index.js').PluginConfig} */
    const pluginConfig = { labels: ['fine'], discussionCategoryName: false };
    await plugin.verifyConditions(pluginConfig, context);
    assert.deepEqual(pluginConfig, { labels: ['fine'], discussionCategoryName: false });
  } finally {
    await server.close();
  }
});

test('a publish option that is a single object or a string is handled', async () => {
  const { server } = await giteaServer();
  try {
    const { context } = contextFor(server.url);
    context.options.publish = { path: 'semantic-release-gitea', discussionCategoryName: 'Releases' };
    await assert.rejects(plugin.verifyConditions({}, context), (/** @type {any} */ error) => [...error.errors].some((e) => e.code === 'EUNSUPPORTEDOPTION'));
    context.options.publish = 'semantic-release-gitea';
    await plugin.verifyConditions({}, context);
  } finally {
    await server.close();
  }
});
