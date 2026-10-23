import AggregateError from 'aggregate-error';
import { createClient as defaultCreateClient } from './client.js';
import { getError } from './definitions/errors.js';
import { parseRepoUrl } from './repo-url.js';
import { resolveConfig } from './resolve-config.js';
import { VALIDATORS } from './verify.js';

/**
 * Sets up what the `fail` step needs and nothing more: a token, a server
 * address, and a repository. It does not read the server version or check
 * write permission, because those checks are among the failures `fail`
 * exists to report (ADR-0008).
 *
 * The repository is read once, and the owner and name the server returns are
 * used, so a repository that was renamed is still found.
 *
 * @param {import('../index.js').PluginConfig} pluginConfig
 * @param {import('../index.js').Context} context
 * @param {{ createClient?: typeof defaultCreateClient }} [dependencies] replaced in tests
 * @returns {Promise<{ config: ReturnType<typeof resolveConfig>, client: import('./client.js').GiteaClient, owner: string, repo: string }>}
 * @throws {AggregateError} with one error for each missing piece
 */
export async function connect(pluginConfig, context, { createClient = defaultCreateClient } = {}) {
  const config = resolveConfig(pluginConfig, context);
  /** @type {Error[]} */
  const errors = [];
  /** @param {string} code @param {Record<string, unknown>} values */
  const add = (code, values = {}) => void errors.push(getError(code, { ...values, token: config.giteaToken }));

  if (typeof config.giteaToken !== 'string' || config.giteaToken === '') add('ENOGITEATOKEN');
  if (!isHttpUrl(config.apiBase)) {
    add('EINVALIDGITEAURL', config.apiBase ? { problem: 'option', option: config.giteaApiUrl ? 'giteaApiUrl' : 'giteaUrl', value: config.giteaApiUrl || config.giteaUrl } : { problem: 'missing' });
  }
  const repository = parseRepoUrl(context.options.repositoryUrl, config.giteaUrl);
  if (!repository) add('EINVALIDGITEAURL', { problem: 'repository-url', value: context.options.repositoryUrl });
  if (errors.length > 0 || !repository) throw new AggregateError(errors);

  const proxy = VALIDATORS.proxy(config.proxy) ? config.proxy : false;
  const client = createClient({ apiBase: config.apiBase, token: /** @type {string} */ (config.giteaToken), proxy });
  const data = /** @type {{ full_name?: unknown }} */ (await client.request('GET', `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`));

  const [owner, repo, ...rest] = typeof data?.full_name === 'string' ? data.full_name.split('/') : [];
  const named = owner && repo && rest.length === 0;
  return { config, client, owner: named ? owner : repository.owner, repo: named ? repo : repository.repo };
}

/** @param {unknown} value */
function isHttpUrl(value) {
  if (typeof value !== 'string' || value === '') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
