import AggregateError from 'aggregate-error';
import { createClient as defaultCreateClient, GiteaApiError } from './client.js';
import { MIN_GITEA_VERSION } from './definitions/constants.js';
import { getError } from './definitions/errors.js';
import { redact } from './redact.js';
import { parseRepoUrl } from './repo-url.js';
import { resolveConfig } from './resolve-config.js';

/** @param {unknown} value @returns {value is string} */
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
/** @param {unknown} value */
const isStringOrStringArray = (value) => isNonEmptyString(value) || (Array.isArray(value) && value.every(isNonEmptyString));
/** @param {(value: unknown) => boolean} validator */
const isArrayOf = (validator) => (/** @type {unknown} */ array) => Array.isArray(array) && array.every(validator);
/** @param {(value: unknown) => boolean} validator */
const canBeDisabled = (validator) => (/** @type {unknown} */ value) => value === false || validator(value);
/** @param {unknown[]} allowed */
const oneOf = (allowed) => (/** @type {unknown} */ value) => allowed.includes(value);
/** @param {unknown} value */
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** An absolute http or https address with no username or password in it. */
function isServerUrl(/** @type {unknown} */ value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** What each option accepts, as in the GitHub plugin. A missing (`undefined` or `null`) option is not checked. */
const VALIDATORS = {
  proxy: canBeDisabled(
    (/** @type {any} */ proxy) => isNonEmptyString(proxy) || (isPlainObject(proxy) && isNonEmptyString(proxy.host) && typeof proxy.port === 'number'),
  ),
  assets: isArrayOf((/** @type {any} */ asset) => isStringOrStringArray(asset) || (isPlainObject(asset) && isStringOrStringArray(asset.path))),
  successComment: canBeDisabled(isNonEmptyString),
  successCommentCondition: canBeDisabled(isNonEmptyString),
  failTitle: canBeDisabled(isNonEmptyString),
  failComment: canBeDisabled(isNonEmptyString),
  failCommentCondition: canBeDisabled(isNonEmptyString),
  labels: canBeDisabled(isArrayOf(isNonEmptyString)),
  assignees: isArrayOf(isNonEmptyString),
  releasedLabels: canBeDisabled(isArrayOf(isNonEmptyString)),
  addReleases: canBeDisabled(oneOf(['bottom', 'top'])),
  draftRelease: (/** @type {unknown} */ value) => typeof value === 'boolean',
  releaseBodyTemplate: isNonEmptyString,
  releaseNameTemplate: isNonEmptyString,
  giteaApiPrefix: isNonEmptyString,
};

/** Problems that make the server checks pointless, because there is no usable address, token or proxy. */
const BLOCKING = new Set(['ENOGITEATOKEN', 'EINVALIDGITEAURL', 'EINVALIDGITEAAPIPREFIX', 'EINVALIDPROXY']);

/**
 * Compares a version string such as `28.10.1+dirty` with the minimum.
 * @param {unknown} version
 * @returns {boolean} false when it is older, or cannot be read as major.minor.patch
 */
function isSupportedVersion(version) {
  const match = typeof version === 'string' ? /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim()) : null;
  if (!match) return false;
  const found = match.slice(1).map(Number);
  const minimum = MIN_GITEA_VERSION.split('.').map(Number);
  for (let i = 0; i < minimum.length; i += 1) {
    if (found[i] !== minimum[i]) return found[i] > minimum[i];
  }
  return true;
}

/**
 * Checks the options, the environment and the Gitea server, and says everything
 * that is wrong at once. Run it before a release so a bad setup fails early.
 *
 * @param {import('../index.js').PluginConfig} pluginConfig
 * @param {import('../index.js').Context} context
 * @param {{ createClient?: typeof defaultCreateClient }} [dependencies] replaced in tests
 * @returns {Promise<{ config: ReturnType<typeof resolveConfig>, client: import('./client.js').GiteaClient, owner: string, repo: string }>}
 * @throws {AggregateError} with one SemanticReleaseError for each problem found
 */
export async function verify(pluginConfig, context, { createClient = defaultCreateClient } = {}) {
  const { options, logger } = context;
  const config = resolveConfig(pluginConfig, context);
  /** @type {Error[]} */
  const errors = [];
  /** @type {string[]} */
  const codes = [];
  /** @param {string} code @param {Record<string, unknown>} [values] */
  const add = (code, values) => {
    errors.push(getError(code, { ...values, token: config.giteaToken }));
    codes.push(code);
  };

  // Option values.
  const resolved = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (config));
  for (const [option, valid] of Object.entries(VALIDATORS)) {
    const value = resolved[option];
    if (value !== undefined && value !== null && !valid(value)) {
      add(`EINVALID${option.toUpperCase()}`, { option, value });
    }
  }
  for (const option of /** @type {const} */ (['giteaUrl', 'giteaApiUrl'])) {
    const value = config[option];
    if (value !== undefined && value !== null && !isServerUrl(value)) {
      add('EINVALIDGITEAURL', { problem: 'option', option, value });
    }
  }

  // Options Gitea cannot honor, and the one that must never be in a config file.
  if (config.discussionCategoryName !== false) add('EUNSUPPORTEDOPTION', { option: 'discussionCategoryName' });
  if (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (pluginConfig)).giteaToken !== undefined) {
    add('EUNSUPPORTEDOPTION', { option: 'giteaToken' });
  }

  // Token and addresses.
  if (!isNonEmptyString(config.giteaToken)) add('ENOGITEATOKEN');
  const addressAlreadyReported = codes.includes('EINVALIDGITEAURL') || codes.includes('EINVALIDGITEAAPIPREFIX');
  if (!config.apiBase && !addressAlreadyReported) add('EINVALIDGITEAURL', { problem: 'missing' });
  const repository = parseRepoUrl(options.repositoryUrl, config.giteaUrl);
  if (!repository) add('EINVALIDGITEAURL', { problem: 'repository-url', value: options.repositoryUrl });

  if (!repository || codes.some((code) => BLOCKING.has(code))) throw new AggregateError(errors);

  const { owner, repo } = repository;
  logger.log('Verify Gitea authentication (%s)', redact(config.apiBase));
  const client = createClient({ apiBase: config.apiBase, token: /** @type {string} */ (config.giteaToken), proxy: config.proxy });

  if (await checkServer(client, add, owner, repo)) await checkRepository(client, add, owner, repo, options.repositoryUrl);

  if (errors.length > 0) throw new AggregateError(errors);
  return { config, client, owner, repo };
}

/**
 * Reads the server version. Returns false when the next check cannot run.
 * @param {import('./client.js').GiteaClient} client
 * @param {(code: string, values?: Record<string, unknown>) => void} add
 * @param {string} owner
 * @param {string} repo
 */
async function checkServer(client, add, owner, repo) {
  /** @type {unknown} */
  let answer;
  try {
    answer = await client.request('GET', '/version');
  } catch (error) {
    if (error instanceof GiteaApiError && error.status === 401) {
      add('EINVALIDGITEATOKEN', { owner, repo });
      return false;
    }
    if (/** @type {any} */ (error)?.code === 'EMISSINGPROXYPACKAGE') {
      add('EMISSINGPROXYPACKAGE', { proxy: 'the configured proxy' });
      return false;
    }
    throw error;
  }
  const version = isPlainObject(answer) ? /** @type {any} */ (answer).version : undefined;
  if (!isSupportedVersion(version)) add('EUNSUPPORTEDGITEAVERSION', { version: typeof version === 'string' ? version : 'unreadable' });
  return true;
}

/**
 * Checks that the repository exists, was not renamed, and can be pushed to.
 * @param {import('./client.js').GiteaClient} client
 * @param {(code: string, values?: Record<string, unknown>) => void} add
 * @param {string} owner
 * @param {string} repo
 * @param {string} repositoryUrl
 */
async function checkRepository(client, add, owner, repo, repositoryUrl) {
  /** @type {any} */
  let data;
  try {
    data = await client.request('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  } catch (error) {
    if (error instanceof GiteaApiError && error.status === 401) return add('EINVALIDGITEATOKEN', { owner, repo });
    if (error instanceof GiteaApiError && error.status === 404) return add('EMISSINGREPO', { owner, repo });
    throw error;
  }

  // A renamed repository still answers at its old address, so compare with what the server calls it now.
  const cloned = typeof data?.clone_url === 'string' ? parseRepoUrl(data.clone_url) : null;
  if (!cloned || `${owner}/${repo}`.toLowerCase() !== `${cloned.owner}/${cloned.repo}`.toLowerCase()) {
    add('EMISMATCHGITEAURL', { repositoryUrl, clone_url: data?.clone_url ?? 'nothing' });
  }
  // Checked under Gitea Actions too: its built-in token reports `permissions` (docs/gitea-api-verification.md, check 10).
  if (data?.permissions?.push !== true) add('EGITEANOPERMISSION', { owner, repo });
}
