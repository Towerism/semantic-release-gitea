/**
 * Entry point of the semantic-release plugin. semantic-release calls these
 * five functions at fixed steps of a release. Every step but `fail` verifies
 * the setup first; `fail` does not, because the checks of `verifyConditions`
 * are among the failures it has to report (ADR-0008).
 */
import { addChannel as addChannelStep } from './lib/add-channel.js';
import { connect } from './lib/connect.js';
import { PLUGIN_NAME } from './lib/definitions/constants.js';
import { fail as failStep } from './lib/fail.js';
import { publish as publishStep } from './lib/publish.js';
import { resolveConfig } from './lib/resolve-config.js';
import { success as successStep } from './lib/success.js';
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
 * Comments on the pull requests and issues the release contains, labels them,
 * closes the open failure issues, and lists the other releases in the notes.
 *
 * @param {import('./index.js').PluginConfig} pluginConfig
 * @param {import('./index.js').Context} context
 * @returns {Promise<void>}
 */
export async function success(pluginConfig, context) {
  return successStep(await getVerified(pluginConfig, context), context);
}

/**
 * Opens an issue for a failed release, or comments on the one that is open.
 * It does not run the full verification: it needs only a token, a server
 * address and a repository.
 *
 * @param {import('./index.js').PluginConfig} pluginConfig
 * @param {import('./index.js').Context} context
 * @returns {Promise<void>}
 */
export async function fail(pluginConfig, context) {
  return failStep(await connect(withPublishEntry(pluginConfig, context), context), context);
}
