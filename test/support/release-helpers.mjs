import assert from 'node:assert/strict';
import { resolveConfig } from '../../lib/resolve-config.js';

/**
 * @typedef {{ method: string, path: string, options: any }} Call
 */

/**
 * A stand-in for the Gitea client. `handler` answers each call with a body or
 * throws; every call is recorded in order.
 * @param {(call: Call) => unknown} handler
 */
export function fakeClient(handler) {
  /** @type {Call[]} */
  const calls = [];
  const client = {
    request: async (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ options = {}) => {
      const call = { method, path, options };
      calls.push(call);
      return handler(call);
    },
    paginate: async () => assert.fail('release steps must not page'),
  };
  return { client: /** @type {import('../../lib/client.js').GiteaClient} */ (client), calls };
}

export const RELEASE_URL = 'https://git.example/o/r/releases/tag/v1.2.0';
export const DOWNLOAD_URL = 'https://git.example/o/r/releases/download/v1.2.0/file';

/** Answers like a Gitea server that accepts every release call. */
export function acceptingHandler() {
  return (/** @type {Call} */ { method, path }) => {
    if (method === 'POST' && path.endsWith('/assets')) return { browser_download_url: DOWNLOAD_URL };
    if (method === 'GET' || method === 'POST' || method === 'PATCH') return { id: 7, html_url: RELEASE_URL };
    return assert.fail(`unexpected ${method} ${path}`);
  };
}

/** A logger that records what was said, as `[level, message, ...values]`. */
export function recordingLogger() {
  /** @type {Array<[string, ...unknown[]]>} */
  const lines = [];
  /** @param {string} level */
  const at = (level) => (/** @type {string} */ message, /** @type {unknown[]} */ ...values) => void lines.push([level, message, ...values]);
  return { logger: { log: at('log'), warn: at('warn'), error: at('error'), success: at('success') }, lines };
}

/**
 * Builds what a release step receives: the verified result and the context.
 * @param {object} [overrides]
 * @param {Record<string, unknown>} [overrides.config] plugin options
 * @param {Record<string, unknown>} [overrides.context] fields merged over the default context
 * @param {(call: Call) => unknown} [overrides.handler] replaces the default server answers
 */
export function setup({ config = {}, context = {}, handler = acceptingHandler() } = {}) {
  const { logger, lines } = recordingLogger();
  const resolved = resolveConfig(/** @type {any} */ (config), { env: { GITEA_TOKEN: 'tok', GITEA_URL: 'https://git.example' } });
  const fake = fakeClient(handler);
  const full = /** @type {import('../../index.js').Context} */ (
    /** @type {unknown} */ ({
      cwd: process.cwd(),
      env: {},
      logger,
      options: { repositoryUrl: 'https://git.example/o/r.git' },
      branch: { name: 'main', type: 'release', main: true, prerelease: false },
      nextRelease: { version: '1.2.0', gitTag: 'v1.2.0', gitHead: 'abc', name: '1.2.0', notes: 'N', type: 'minor', channel: null },
      ...context,
    })
  );
  return { verified: { config: resolved, client: fake.client, owner: 'o', repo: 'r' }, calls: fake.calls, context: full, lines };
}
