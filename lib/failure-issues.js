import { FAILURE_MARKER } from './definitions/constants.js';

/**
 * Finds the open issues this plugin opened for failed releases.
 *
 * The listing is not narrowed by label. On Gitea 28.2.0 a label that does not
 * exist is dropped from the filter, and when two labels share one name the
 * filtered list returned no issue that carried one of them, which would hide
 * the failure issue (docs/gitea-api-verification.md, check 12). The hidden
 * marker in the body is what decides.
 *
 * @param {import('./client.js').GiteaClient} client
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<Array<{ number: number, body: string }>>} lowest issue number first
 */
export async function findFailureIssues(client, owner, repo) {
  const issues = /** @type {unknown[]} */ (
    await client.paginate(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, { query: { state: 'open', type: 'issues' } })
  );
  return /** @type {Array<{ number: number, body: string }>} */ (
    issues.filter(
      (issue) =>
        typeof issue === 'object' &&
        issue !== null &&
        typeof (/** @type {any} */ (issue).number) === 'number' &&
        typeof (/** @type {any} */ (issue).body) === 'string' &&
        /** @type {any} */ (issue).body.includes(FAILURE_MARKER),
    )
  ).sort((a, b) => a.number - b.number);
}
