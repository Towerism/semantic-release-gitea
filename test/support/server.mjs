import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

/**
 * @typedef {{ source: string, giteaVersion: string | null, status: number, headers?: Record<string, string>, body?: unknown }} Fixture
 * @typedef {{ method: string, url: string, headers: import('node:http').IncomingHttpHeaders, body: string }} RecordedRequest
 */

/**
 * @param {string} name file name under test/fixtures, without .json
 * @returns {Fixture}
 */
export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

/**
 * Starts a local HTTP server on a free port that answers from a script.
 * Request number n gets step n; the last step answers every request after it.
 * A step is a fixture, or a function that writes the response itself.
 *
 * @param {Array<Fixture | ((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void)>} steps
 * @returns {Promise<{ url: string, requests: RecordedRequest[], close: () => Promise<void> }>}
 */
export async function serve(steps) {
  /** @type {RecordedRequest[]} */
  const requests = [];
  /** @type {string} */
  let url = '';
  const server = createServer((req, res) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: String(req.method), url: String(req.url), headers: req.headers, body: Buffer.concat(chunks).toString() });
      const step = steps[Math.min(requests.length, steps.length) - 1];
      if (typeof step === 'function') return step(req, res);
      const headers = Object.fromEntries(Object.entries(step.headers ?? {}).map(([k, v]) => [k, v.replaceAll('{base}', url)]));
      const text = step.body === undefined ? '' : typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
      res.writeHead(step.status, typeof step.body === 'string' ? headers : { 'content-type': 'application/json', ...headers });
      res.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
