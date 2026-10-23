/**
 * Whether a release made on this branch is a pre-release. Same rule as the
 * GitHub plugin. It reads the branch semantic-release passes in, not the
 * release: a release's own `type` is `major`, `minor` or `patch`.
 *
 * @param {{ type?: string, main?: boolean, prerelease?: boolean | string }} branch
 * @returns {boolean}
 */
export function isPrerelease({ type, main, prerelease }) {
  if (prerelease === false) return false;
  return type === 'prerelease' || (type === 'release' && !main) || typeof prerelease === 'string' || prerelease === true;
}
