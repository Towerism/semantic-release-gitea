import { FAILURE_LABEL, FAILURE_MARKER } from './definitions/constants.js';

/**
 * Finds the open issues this plugin opened for failed releases.
 *
 * The label filter only narrows the listing. How Gitea treats several labels,
 * a label that does not exist and a comma in a label name was not measured, so
 * the hidden marker in the body is what decides.
 *
 * @param {import('./client.js').GiteaClient} client
 * @param {string} owner
 * @param {string} repo
 * @param {string[]} labels the `labels` option; the failure label is added
 * @returns {Promise<Array<{ number: number, body: string }>>} lowest issue number first
 */
export async function findFailureIssues(client, owner, repo, labels) {
  const issues = /** @type {Array<{ number: number, body: string | null }>} */ (
    await client.paginate(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      query: { state: 'open', type: 'issues', labels: [...new Set([...labels, FAILURE_LABEL])].join(',') },
    })
  );
  return /** @type {Array<{ number: number, body: string }>} */ (issues.filter(({ body }) => typeof body === 'string' && body.includes(FAILURE_MARKER))).sort(
    (a, b) => a.number - b.number,
  );
}
