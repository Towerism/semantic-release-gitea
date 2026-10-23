/**
 * Paths and answers shared by the two release steps.
 */

/**
 * @param {string} owner
 * @param {string} repo
 * @returns {string} path of the repository's releases, relative to the API base
 */
export function releasesPath(owner, repo) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
}

/**
 * @param {unknown} answer
 * @param {string} field
 * @returns {unknown}
 */
function read(answer, field) {
  return typeof answer === 'object' && answer !== null ? /** @type {Record<string, unknown>} */ (answer)[field] : undefined;
}

/** @param {string} field */
const missing = (field) => new Error(`Gitea answered a release request without a usable \`${field}\`, so the release cannot be reported.`);

/**
 * Reads a text field the step needs from an answer of Gitea, and says which
 * one is missing instead of letting `undefined` travel on.
 *
 * @param {unknown} answer
 * @param {'html_url' | 'browser_download_url'} field
 * @returns {string}
 */
export function requiredString(answer, field) {
  const value = read(answer, field);
  if (typeof value !== 'string' || value === '') throw missing(field);
  return value;
}

/**
 * Reads the release number from an answer of Gitea.
 *
 * @param {unknown} answer
 * @returns {number}
 */
export function requiredId(answer) {
  const value = read(answer, 'id');
  if (typeof value !== 'number') throw missing('id');
  return value;
}
