import { GiteaApiError } from './client.js';
import { LABEL_COLOR } from './definitions/constants.js';

/**
 * Turns label names into the numeric ids Gitea wants when an issue is created,
 * creating the labels that do not exist yet.
 *
 * Names are compared exactly. If a create fails with a 4xx answer, another run
 * may have made the label first, so the labels are listed once more: a name
 * that is there now is used, and otherwise the original error is thrown. The
 * status Gitea uses for a duplicate name was not measured, so any 4xx counts.
 *
 * @param {import('./client.js').GiteaClient} client
 * @param {string} owner
 * @param {string} repo
 * @param {string[]} names
 * @returns {Promise<number[]>} one id per name, in the same order
 */
export async function ensureLabels(client, owner, repo, names) {
  if (names.length === 0) return [];
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`;
  const ids = await listIds(client, path);

  for (const name of new Set(names)) {
    if (ids.has(name)) continue;
    try {
      const created = /** @type {{ id?: unknown }} */ (await client.request('POST', path, { json: { name, color: LABEL_COLOR } }));
      if (typeof created?.id !== 'number') throw new Error(`Gitea answered the creation of the label "${name}" without an id.`);
      ids.set(name, created.id);
    } catch (error) {
      if (!(error instanceof GiteaApiError) || error.status < 400 || error.status >= 500) throw error;
      const again = await listIds(client, path);
      const id = again.get(name);
      if (id === undefined) throw error;
      ids.set(name, id);
    }
  }
  return names.map((name) => /** @type {number} */ (ids.get(name)));
}

/**
 * @param {import('./client.js').GiteaClient} client
 * @param {string} path
 * @returns {Promise<Map<string, number>>} label id by name
 */
async function listIds(client, path) {
  const labels = /** @type {Array<{ id: number, name: string }>} */ (await client.paginate(path));
  return new Map(labels.map(({ id, name }) => [name, id]));
}
