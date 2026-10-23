import { readFile } from 'node:fs/promises';
import { template } from 'lodash-es';
import { prepareAssets } from './assets.js';
import { RELEASE_NAME, UPLOAD_TIMEOUT_MS } from './definitions/constants.js';
import { isPrerelease } from './is-prerelease.js';
import { releasesPath, requiredId, requiredString } from './release-api.js';

/**
 * Creates the release for the new version on Gitea.
 *
 * With assets, the release is created as a draft first, the files are
 * uploaded to it, and only then is it published. A server that sends a
 * release event therefore sees the files already attached. With the
 * `draftRelease` option it stays a draft.
 *
 * Everything that can fail without the server (templates, finding the files)
 * is done before the first request, so a mistake there leaves nothing behind.
 *
 * @param {{ config: ReturnType<typeof import('./resolve-config.js').resolveConfig>, client: import('./client.js').GiteaClient, owner: string, repo: string }} verified
 * @param {import('../index.js').Context} context
 * @returns {Promise<{ url: string, name: string, id: number }>}
 */
export async function publish({ config, client, owner, repo }, context) {
  const { logger, branch } = context;
  const nextRelease = /** @type {import('../index.js').NextRelease} */ (context.nextRelease);
  const path = releasesPath(owner, repo);

  const release = {
    tag_name: nextRelease.gitTag,
    target_commitish: branch?.name,
    name: template(config.releaseNameTemplate)(context),
    body: template(config.releaseBodyTemplate)(context),
    prerelease: isPrerelease(branch ?? {}),
  };
  const assets = config.assets && config.assets.length > 0 ? await prepareAssets(context, config.assets) : undefined;

  // No assets: one request, published at once unless a draft was asked for.
  if (!assets) {
    const created = await client.request('POST', path, { json: { ...release, draft: config.draftRelease } });
    const url = requiredString(created, 'html_url');
    const id = requiredId(created);
    logger.log(config.draftRelease ? 'Created Gitea draft release: %s' : 'Published Gitea release: %s', url);
    return { url, name: RELEASE_NAME, id };
  }

  const draft = await client.request('POST', path, { json: { ...release, draft: true } });
  const draftUrl = requiredString(draft, 'html_url');
  const id = requiredId(draft);

  // One at a time: a small self-hosted server should not take every upload at once.
  for (const asset of assets) {
    const form = new FormData();
    form.append('attachment', new Blob([await readFile(asset.path)]), asset.name);
    try {
      const uploaded = await client.request('POST', `${path}/${id}/assets`, { query: { name: asset.name }, body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
      logger.log('Published file %s', requiredString(uploaded, 'browser_download_url'));
    } catch (error) {
      // The draft stays on the server. Say where, so the maintainer can delete it.
      logger.error('Draft release left on the server: %s', draftUrl);
      throw error;
    }
  }

  if (config.draftRelease) {
    logger.log('Created Gitea draft release: %s', draftUrl);
    return { url: draftUrl, name: RELEASE_NAME, id };
  }

  const published = await client.request('PATCH', `${path}/${id}`, { json: { draft: false } });
  const url = requiredString(published, 'html_url');
  logger.log('Published Gitea release: %s', url);
  return { url, name: RELEASE_NAME, id };
}
