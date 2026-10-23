import { DEFAULT_API_PREFIX } from './definitions/constants.js';

/** @template T @param {T | T[] | undefined} value @returns {T[] | undefined} */
const toArray = (value) => (value === undefined || value === null ? undefined : Array.isArray(value) ? value : [value]);

/** @param {unknown} value */
const isNil = (value) => value === undefined || value === null;

/**
 * Merges the plugin options, the environment and the defaults.
 *
 * The token is read only from `GITEA_TOKEN`, so it cannot end up in a
 * committed config file. `GH_TOKEN` and `GITHUB_TOKEN` are never read, so a
 * leftover GitHub token cannot be sent to a Gitea server.
 *
 * @param {import('../index.js').PluginConfig} pluginConfig
 * @param {Pick<import('../index.js').Context, 'env'>} context
 */
export function resolveConfig(pluginConfig, { env }) {
  const {
    giteaUrl,
    giteaApiUrl,
    giteaApiPrefix,
    proxy,
    assets,
    successComment,
    successCommentCondition,
    failTitle,
    failComment,
    failCommentCondition,
    labels,
    assignees,
    releasedLabels,
    addReleases,
    draftRelease,
    releaseNameTemplate,
    releaseBodyTemplate,
    discussionCategoryName,
  } = pluginConfig;

  const resolvedUrl = giteaUrl || env.GITEA_URL;
  const resolvedPrefix = giteaApiPrefix || env.GITEA_PREFIX || DEFAULT_API_PREFIX;

  return {
    // A token read from a file often ends in a newline, which is not allowed in a header.
    giteaToken: env.GITEA_TOKEN?.trim(),
    giteaUrl: resolvedUrl,
    giteaApiUrl,
    giteaApiPrefix: resolvedPrefix,
    apiBase: buildApiBase(giteaApiUrl, resolvedUrl, resolvedPrefix),
    proxy: isNil(proxy) ? env.http_proxy || env.HTTP_PROXY || false : proxy,
    assets: toArray(assets),
    successComment,
    successCommentCondition,
    failTitle: isNil(failTitle) ? 'The automated release is failing 🚨' : failTitle,
    failComment,
    failCommentCondition,
    labels: isNil(labels) ? ['semantic-release'] : labels === false ? false : toArray(labels),
    assignees: toArray(assignees),
    releasedLabels: isNil(releasedLabels)
      ? ['released<%= nextRelease.channel ? ` on @${nextRelease.channel}` : "" %>']
      : releasedLabels === false
        ? false
        : toArray(releasedLabels),
    addReleases: isNil(addReleases) ? false : addReleases,
    draftRelease: isNil(draftRelease) ? false : draftRelease,
    releaseBodyTemplate: isNil(releaseBodyTemplate) ? '<%= nextRelease.notes %>' : releaseBodyTemplate,
    releaseNameTemplate: isNil(releaseNameTemplate) ? '<%= nextRelease.name %>' : releaseNameTemplate,
    discussionCategoryName: isNil(discussionCategoryName) ? false : discussionCategoryName,
  };
}

/**
 * @param {unknown} apiUrl
 * @param {unknown} serverUrl
 * @param {unknown} prefix
 * @returns {string} empty when there is no usable address
 */
function buildApiBase(apiUrl, serverUrl, prefix) {
  if (typeof apiUrl === 'string' && apiUrl) return apiUrl.replace(/\/+$/, '');
  if (typeof serverUrl !== 'string' || !serverUrl || typeof prefix !== 'string') return '';
  const folder = prefix.replace(/^\/+|\/+$/g, '');
  const server = serverUrl.replace(/\/+$/, '');
  return folder ? `${server}/${folder}` : server;
}
