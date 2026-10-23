import { GiteaApiError } from '../../lib/client.js';

/**
 * @typedef {{ method: string, path: string, options: any, paged: boolean }} RoutedCall
 */

/**
 * A stand-in for the Gitea client for the steps that list and page. `handler`
 * answers every call, whether it came through `request` or `paginate`, with a
 * body, or throws. Calls are recorded in order. The most calls that were
 * waiting for an answer at the same time are counted in `peak()`.
 *
 * Each call yields to the event loop once before it is answered, so calls that
 * the code under test starts together really do overlap. No timers are used.
 *
 * @param {(call: RoutedCall) => unknown} handler
 */
export function routedClient(handler) {
  /** @type {RoutedCall[]} */
  const calls = [];
  let active = 0;
  let highest = 0;

  /** @param {RoutedCall} call */
  async function answer(call) {
    calls.push(call);
    active += 1;
    highest = Math.max(highest, active);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return await handler(call);
    } finally {
      active -= 1;
    }
  }

  const client = {
    request: (/** @type {string} */ method, /** @type {string} */ path, /** @type {any} */ options = {}) => answer({ method, path, options, paged: false }),
    paginate: async (/** @type {string} */ path, /** @type {any} */ options = {}) => {
      const body = await answer({ method: 'GET', path, options, paged: true });
      return /** @type {unknown[]} */ (body);
    },
  };
  return {
    client: /** @type {import('../../lib/client.js').GiteaClient} */ (client),
    calls,
    peak: () => highest,
  };
}

/**
 * An error as the real client throws it for an answer with `status`.
 * @param {number} status
 * @param {string} [message]
 */
export function apiError(status, message = `status ${status}`) {
  return new GiteaApiError(message, { method: 'GET', path: '/x', status });
}

/** @param {RoutedCall[]} calls */
export const lines = (calls) => calls.map(({ method, path }) => `${method} ${path}`);
