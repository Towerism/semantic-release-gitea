/**
 * A small client for the Gitea API calls the end-to-end test makes directly.
 * The test logs go to a public Actions page, so no error thrown here may hold
 * a response body or the token.
 *
 * @param {{ root: string, token: string, timeoutMs?: number }} options
 */
export function createApi({ root, token, timeoutMs = 60_000 }) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [json]
   * @returns {Promise<{ status: number, body: any }>}
   */
  return async function api(method, path, json) {
    const label = `${method} ${path}`;
    let response;
    let text;
    try {
      response = await fetch(`${root}/api/v1${path}`, {
        method,
        headers: { authorization: `token ${token}`, ...(json === undefined ? {} : { 'content-type': 'application/json' }) },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error(`${label} timed out after ${timeoutMs} ms`);
      throw new Error(`${label} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    if (!text) return { status: response.status, body: null };
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      throw new Error(`${label} returned status ${response.status} with a body that is not JSON`);
    }
  };
}
