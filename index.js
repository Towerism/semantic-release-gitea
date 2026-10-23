/**
 * Entry point of the semantic-release plugin. semantic-release calls these
 * five functions at fixed steps of a release. `verifyConditions`, `publish` and
 * `addChannel` are built; `success` and `fail` reject until the issue that
 * implements them lands.
 */
import { addChannel as addChannelStep } from './lib/add-channel.js';
import { PLUGIN_NAME } from './lib/definitions/constants.js';
import { publish as publishStep } from './lib/publish.js';
import { resolveConfig } from './lib/resolve-config.js';
import { verify } from './lib/verify.js';

/** Options that a legacy `publish` entry may carry, checked early so a bad one fails before any release step. */
const PUBLISH_ENTRY_OPTIONS = /** @type {const} */ ([
  'assets',
  'successComment',
  'failComment',
  'failTitle',
  'labels',
  'assignees',
  'discussionCategoryName',
]);

/**
 * Verification results by config, so a release verifies each distinct config once.
 * A promise is stored, so two calls at the same time share one verification.
 * @type {Map<string, ReturnType<typeof verify>>}
 */
const verified = new Map();

/**
 * Fills in options this plugin's own config leaves out from this plugin's
 * entry in the legacy top-level `publish` option, as the GitHub plugin does.
 * Works on a copy: the config semantic-release passed in is not changed.
 *
 * @param {import('./index.js').PluginConfig} pluginConfig
 * @param {import('./index.js').Context} context
 * @returns {import('./index.js').PluginConfig}
 */
function withPublishEntry(pluginConfig, context) {
  const { publish } = context.options;
  if (!publish) return pluginConfig;
  const entries = Array.isArray(publish) ? publish : [publish];
  const entry = entries.find((item) => typeof item === 'object' && item !== null && item.path === PLUGIN_NAME);
  if (!entry || typeof entry === 'string') return pluginConfig;

  const merged = { ...pluginConfig };
  for (const option of PUBLISH_ENTRY_OPTIONS) {
    if (merged[option] === undefined || merged[option] === null) {
      Object.assign(merged, entry[option] === undefined ? {} : { [option]: entry[option] });
    }
  }
  return merged;
}

/**
 * Every step calls this first. It returns the stored result when this config
 * was already verified in this process, and verifies it otherwise. A failed
 * verification is not stored.
 *
 * @param {import('./index.js').PluginConfig} pluginConfig
 * @param {import('./index.js').Context} context
 */
async function getVerified(pluginConfig, context) {
  const merged = withPublishEntry(pluginConfig, context);
  // The token is left out of the key: it comes from the environment and is the same for the whole process.
  const { giteaToken: _token, ...resolved } = resolveConfig(merged, context);
  const key = JSON.stringify([resolved, context.options.repositoryUrl, 'giteaToken' in merged]);

  let pending = verified.get(key);
  if (!pending) {
    const attempt = verify(merged, context);
    pending = attempt;
    verified.set(key, attempt);
    attempt.catch(() => {
      if (verified.get(key) === attempt) verified.delete(key);
    });
  }
  return pending;
}

/**
 * @param {string} step
 * @returns {Promise<never>}
 */
async function notImplemented(step) {
  throw new Error(`semantic-release-gitea: ${step} is not implemented yet`);
}

/**
 * Checks the options, the token, the server version and the repository, and
 * fails the release early with every problem found.
 *
 * @param {import('./index.js').PluginConfig} pluginConfig
 * @param {import('./index.js').Context} context
 * @returns {Promise<void>}
 */
export async function verifyConditions(pluginConfig, context) {
  await getVerified(pluginConfig, context);
}

/**
 * Creates the release on Gitea, uploading the `assets` first when there are any.
 *
 * @param {import('./index.js').PluginConfig} pluginConfig
 * @param {import('./index.js').Context} context
 * @returns {Promise<import('./index.js').ReleaseInfo>}
 */
export async function publish(pluginConfig, context) {
  return publishStep(await getVerified(pluginConfig, context), context);
}

/**
 * Updates the release for the tag when a version moves to another channel, or
 * creates it when there is none.
 *
 * @param {import('./index.js').PluginConfig} pluginConfig
 * @param {import('./index.js').Context} context
 * @returns {Promise<import('./index.js').ReleaseInfo>}
 */
export async function addChannel(pluginConfig, context) {
  return addChannelStep(await getVerified(pluginConfig, context), context);
}

/**
 * @param {import('./index.js').PluginConfig} _pluginConfig
 * @param {import('./index.js').Context} _context
 * @returns {Promise<void>}
 */
export async function success(_pluginConfig, _context) {
  return notImplemented('success');
}

/**
 * @param {import('./index.js').PluginConfig} _pluginConfig
 * @param {import('./index.js').Context} _context
 * @returns {Promise<void>}
 */
export async function fail(_pluginConfig, _context) {
  return notImplemented('fail');
}
