import { GiteaApiError } from './client.js';
import { RELEASE_NAME } from './definitions/constants.js';
import { isPrerelease } from './is-prerelease.js';
import { releasesPath, requiredId, requiredString } from './release-api.js';

/**
 * Moves an existing release to another channel: updates its name and
 * pre-release flag. When no release exists for the tag, creates one from the
 * release notes. The body and draft state of an existing release are left alone.
 *
 * @param {{ config: ReturnType<typeof import('./resolve-config.js').resolveConfig>, client: import('./client.js').GiteaClient, owner: string, repo: string }} verified
 * @param {import('../index.js').Context} context
 * @returns {Promise<{ url: string, name: string }>}
 */
export async function addChannel({ client, owner, repo }, context) {
  const { logger, branch } = context;
  const nextRelease = /** @type {import('../index.js').NextRelease} */ (context.nextRelease);
  const path = releasesPath(owner, repo);
  const release = { tag_name: nextRelease.gitTag, name: nextRelease.name, prerelease: isPrerelease(branch ?? {}) };

  /** @type {unknown} */
  let existing;
  try {
    existing = await client.request('GET', `${path}/tags/${encodeURIComponent(nextRelease.gitTag)}`);
  } catch (error) {
    if (!(error instanceof GiteaApiError && error.status === 404)) throw error;
    logger.log('There is no release for tag %s, creating a new one', nextRelease.gitTag);
    const created = await client.request('POST', path, { json: { ...release, body: nextRelease.notes ?? '' } });
    const url = requiredString(created, 'html_url');
    logger.log('Published Gitea release: %s', url);
    return { url, name: RELEASE_NAME };
  }

  const id = requiredId(existing);
  const updated = await client.request('PATCH', `${path}/${id}`, { json: release });
  const url = requiredString(updated, 'html_url');
  logger.log('Updated Gitea release: %s', url);
  return { url, name: RELEASE_NAME };
}
