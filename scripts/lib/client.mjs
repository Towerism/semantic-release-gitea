// The only module in the spike that calls fetch. It sends the token only to
// the configured origin, never follows a redirect, applies a timeout, and
// returns scrubbed results. It does not throw on HTTP or network failures:
// the spike records those as observations.
import { makeScrubber, filterHeaders } from './scrub.mjs';

const API_PREFIX = '/api/v1';
const DEFAULT_TIMEOUT_MS = 30_000;

export function createClient({
  baseUrl,
  token,
  host = new URL(baseUrl).hostname,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  makeSignal = () => AbortSignal.timeout(timeoutMs),
}) {
  const scrub = makeScrubber({ token, host });
  const origin = new URL(baseUrl).origin;

  async function request(method, path, { json, body, headers = {} } = {}) {
    if (!path.startsWith('/')) throw new Error('path must be relative to the API root and start with /');
    const init = {
      method,
      redirect: 'manual',
      signal: makeSignal(),
      headers: { authorization: `token ${token}`, accept: 'application/json', ...headers },
    };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['content-type'] = 'application/json';
    } else if (body !== undefined) {
      init.body = body;
    }
    let response;
    try {
      response = await fetchImpl(`${origin}${API_PREFIX}${path}`, init);
    } catch (error) {
      return { status: 0, error: scrub(error) };
    }
    const text = await response.text().catch(() => '');
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON: keep the text
    }
    return {
      status: response.status,
      redirected: response.status >= 300 && response.status < 400,
      headers: filterHeaders(response.headers),
      body: scrub(parsed),
    };
  }

  return { request, scrub };
}
