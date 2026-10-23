import { getError } from './definitions/errors.js';
import { redact } from './redact.js';

const RETRY_WAITS_MS = [500, 1000, 2000];
const MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
/** Methods that can be repeated without creating a second thing on the server. */
const REPEATABLE = new Set(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']);
/** Connection errors that happen before any request bytes are sent. */
const BEFORE_SEND = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/**
 * @typedef {{ host: string, port: number }} ProxyObject
 * @typedef {{ fetch: typeof globalThis.fetch, ProxyAgent: new (url: string) => unknown }} ProxyModule
 * @typedef {{ json?: unknown, body?: BodyInit, headers?: Record<string, string>, query?: Record<string, string | number> }} RequestOptions
 * @typedef {{
 *   apiBase: string,
 *   token: string,
 *   proxy?: string | ProxyObject | false,
 *   timeoutMs?: number,
 *   fetch?: typeof globalThis.fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   loadProxy?: () => Promise<ProxyModule>,
 * }} ClientOptions
 * @typedef {{
 *   request: (method: string, path: string, options?: RequestOptions) => Promise<unknown>,
 *   paginate: (path: string, options?: RequestOptions) => Promise<unknown[]>,
 * }} GiteaClient
 */

/** An error answer from the Gitea server, or a request that never got an answer (`status` 0). */
export class GiteaApiError extends Error {
  /**
   * @param {string} message
   * @param {{ method: string, path: string, status: number, body?: unknown, cause?: unknown }} details
   */
  constructor(message, { method, path, status, body, cause }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GiteaApiError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

/**
 * Finds the address marked rel="next" in a Link header.
 * @param {string | null} header
 * @returns {string | undefined}
 */
function nextLink(header) {
  for (const part of (header ?? '').split(/,\s*(?=<)/)) {
    const match = /^\s*<([^>]*)>(.*)$/s.exec(part);
    const rel = match && /;\s*rel\s*=\s*"?([^";]*)"?/i.exec(match[2]);
    if (match && rel && rel[1].toLowerCase().split(/\s+/).includes('next')) return match[1];
  }
  return undefined;
}

/** @returns {Promise<ProxyModule>} */
async function loadUndici() {
  const undici = await import('undici');
  return /** @type {ProxyModule} */ (/** @type {unknown} */ (undici));
}

/**
 * The only module that talks to the network. Adds the token header, follows no
 * redirects, retries what is safe to retry, pages through lists, and turns
 * failures into errors that never contain the token.
 *
 * @param {ClientOptions} options
 * @returns {GiteaClient}
 */
export function createClient({
  apiBase,
  token,
  proxy = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetch: fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  loadProxy = loadUndici,
}) {
  const base = new URL(apiBase);
  const basePath = base.pathname.replace(/\/+$/, '');
  /** @type {Promise<{ fetch: typeof globalThis.fetch, dispatcher: unknown }> | undefined} */
  let transport;

  /** Picks `fetch` (and the proxy agent, if any). The proxy package loads on the first call only. */
  function getTransport() {
    transport ??= (async () => {
      if (!proxy) return { fetch: fetchImpl, dispatcher: undefined };
      const proxyUrl = typeof proxy === 'string' ? proxy : `http://${proxy.host}:${proxy.port}`;
      /** @type {ProxyModule} */
      let loaded;
      try {
        loaded = await loadProxy();
      } catch {
        throw getError('EMISSINGPROXYPACKAGE', { proxy: proxyUrl, token });
      }
      return { fetch: loaded.fetch, dispatcher: new loaded.ProxyAgent(proxyUrl) };
    })();
    return transport;
  }

  /** @param {string} text */
  const hide = (text) => redact(text, [token]);

  /**
   * Hides secrets in every string of a parsed body, leaving its shape alone.
   * @param {unknown} body
   * @returns {unknown}
   */
  function hideInBody(body) {
    if (typeof body === 'string') return hide(body);
    if (Array.isArray(body)) return body.map(hideInBody);
    if (body !== null && typeof body === 'object') {
      return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, hideInBody(value)]));
    }
    return body;
  }

  /** @param {string} url */
  function relativePath(url) {
    const { pathname } = new URL(url);
    return pathname.startsWith(basePath) ? pathname.slice(basePath.length) || '/' : pathname;
  }

  /** @param {unknown} error */
  function networkCode(error) {
    const e = /** @type {any} */ (error);
    return String(e?.cause?.code ?? e?.code ?? '');
  }

  /**
   * One round trip with retries. Returns the final response; throws GiteaApiError when it is an error.
   * @param {string} method
   * @param {string} url absolute
   * @param {string} path shown in errors
   * @param {RequestOptions} options
   * @returns {Promise<{ headers: Headers, body: unknown }>}
   */
  async function send(method, url, path, { json, body, headers = {} }) {
    const init = /** @type {RequestInit & { dispatcher?: unknown }} */ ({
      method,
      redirect: 'manual',
      headers: { authorization: `token ${token}`, accept: 'application/json', ...headers },
    });
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      /** @type {Record<string, string>} */ (init.headers)['content-type'] = 'application/json';
    } else if (body !== undefined) {
      init.body = body;
    }
    const repeatable = REPEATABLE.has(method);
    const transportNow = await getTransport();
    init.dispatcher = transportNow.dispatcher;

    for (let attempt = 0; ; attempt += 1) {
      const retriesLeft = attempt < RETRY_WAITS_MS.length;
      /** @type {Response} */
      let response;
      /** @type {string} */
      let text;
      try {
        response = await transportNow.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        // Reading the body is part of the round trip: a connection that drops here is a network error too.
        text = await response.text();
      } catch (error) {
        const canRetry = repeatable || BEFORE_SEND.has(networkCode(error));
        if (retriesLeft && canRetry) {
          await sleep(RETRY_WAITS_MS[attempt]);
          continue;
        }
        const e = /** @type {any} */ (error);
        const reason = hide([e?.message, e?.cause?.message].filter(Boolean).join(': ') || 'network error');
        const cause = Object.assign(new Error(reason), { name: String(e?.name ?? 'Error'), code: networkCode(error) || undefined });
        throw new GiteaApiError(`Gitea ${method} ${path} failed: ${reason}`, { method, path, status: 0, cause });
      }

      /** @type {unknown} */
      let parsed = text;
      if (!text) parsed = null;
      else {
        try {
          parsed = JSON.parse(text);
        } catch {
          // Not JSON: keep the text.
        }
      }
      if (response.status < 300) return { headers: response.headers, body: parsed };

      if (response.status < 400) {
        let host = 'unknown host';
        try {
          host = new URL(response.headers.get('location') ?? '', url).host;
        } catch {
          // Keep the placeholder.
        }
        throw new GiteaApiError(`Gitea ${method} ${path} answered ${response.status} with a redirect to ${hide(host)}; redirects are not followed, so check giteaUrl.`, {
          method,
          path,
          status: response.status,
        });
      }

      const retryable = response.status === 429 || (response.status >= 500 && repeatable);
      if (retryable && retriesLeft) {
        const wait = waitFor(response.headers.get('retry-after'), RETRY_WAITS_MS[attempt]);
        if (wait <= MAX_RETRY_AFTER_MS) {
          await sleep(wait);
          continue;
        }
      }
      const safeBody = hideInBody(parsed);
      const detail =
        typeof safeBody === 'object' && safeBody !== null && typeof (/** @type {any} */ (safeBody).message) === 'string'
          ? /** @type {any} */ (safeBody).message
          : typeof safeBody === 'string' && safeBody.trim()
            ? safeBody.trim()
            : response.statusText || 'no details';
      throw new GiteaApiError(`Gitea ${method} ${path} failed with ${response.status}: ${detail}`, {
        method,
        path,
        status: response.status,
        body: safeBody,
      });
    }
  }

  /**
   * @param {string | null} header Retry-After value
   * @param {number} fallback backoff wait
   */
  function waitFor(header, fallback) {
    if (!header) return fallback;
    const value = header.trim();
    if (/^\d+$/.test(value)) return Number(value) * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? fallback : Math.max(0, date - now());
  }

  /**
   * @param {string} path
   * @param {Record<string, string | number> | undefined} query
   */
  function buildUrl(path, query) {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new Error('path must be relative to the API base and start with /');
    }
    const url = new URL(`${basePath}${path}`, base.origin);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    return url.toString();
  }

  return {
    async request(method, path, options = {}) {
      const { body } = await send(method, buildUrl(path, options.query), path, options);
      return body;
    },

    async paginate(path, options = {}) {
      /** @type {unknown[]} */
      const items = [];
      let url = buildUrl(path, options.query);
      let shownPath = path;
      const seen = new Set([url]);
      for (;;) {
        const { headers, body } = await send('GET', url, shownPath, options);
        if (!Array.isArray(body)) {
          throw new GiteaApiError(`Gitea GET ${shownPath} did not return a list.`, { method: 'GET', path: shownPath, status: 200 });
        }
        items.push(...body);
        const next = nextLink(headers.get('link'));
        if (!next) return items;
        const nextUrl = new URL(next, url);
        if (nextUrl.origin !== base.origin) {
          throw new GiteaApiError(`Gitea GET ${shownPath} returned a next page on another host (${hide(nextUrl.host)}), which was not requested.`, {
            method: 'GET',
            path: shownPath,
            status: 200,
          });
        }
        url = nextUrl.toString();
        if (seen.has(url)) {
          throw new GiteaApiError(`Gitea GET ${shownPath} pointed at a page it had already returned, so paging stopped to avoid looping.`, {
            method: 'GET',
            path: shownPath,
            status: 200,
          });
        }
        seen.add(url);
        shownPath = relativePath(url);
      }
    },
  };
}
