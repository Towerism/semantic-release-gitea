import SemanticReleaseError from '@semantic-release/error';
import { redact } from '../redact.js';
import { MIN_GITEA_VERSION } from './constants.js';

/**
 * What a valid value looks like, for the details of an EINVALID<OPTION> error.
 * @type {Record<string, string>}
 */
const EXPECTED = {
  proxy: 'a proxy URL string, an object with a `host` string and a numeric `port`, or `false`',
  assets: 'an array of globs (strings), arrays of globs, or objects with a `path`',
  successComment: 'a non-empty string, or `false` to turn it off',
  successCommentCondition: 'a non-empty string, or `false` to turn it off',
  failTitle: 'a non-empty string, or `false` to turn it off',
  failComment: 'a non-empty string, or `false` to turn it off',
  failCommentCondition: 'a non-empty string, or `false` to turn it off',
  labels: 'an array of non-empty strings, or `false` to turn it off',
  assignees: 'an array of non-empty strings',
  releasedLabels: 'an array of non-empty strings, or `false` to turn it off',
  addReleases: '`"top"`, `"bottom"` or `false`',
  draftRelease: 'a boolean',
  releaseBodyTemplate: 'a non-empty string',
  releaseNameTemplate: 'a non-empty string',
  giteaUrl: 'an absolute http or https URL with no username or password, such as `https://git.example`',
  giteaApiUrl: 'an absolute http or https URL with no username or password, such as `https://git.example/api/v1`',
  giteaApiPrefix: 'a non-empty string, such as `/api/v1`',
};

/**
 * @param {unknown} value
 * @param {unknown} token
 * @returns {string}
 */
function show(value, token) {
  let text;
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    text = String(value);
  }
  text = redact(text, [typeof token === 'string' ? token : undefined]);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * Builds the `{ message, details }` text for one error code.
 * Each builder gets the context with every value already made safe to print.
 * @type {Record<string, (c: Record<string, string>) => { message: string, details: string }>}
 */
const BUILDERS = {
  EINVALIDGITEAURL: (c) => {
    if (c.problem === 'missing') {
      return {
        message: 'No Gitea server URL is set.',
        details:
          'Set the `giteaUrl` option, or the `GITEA_URL` environment variable, to the address of your Gitea server, such as `https://git.example`. ' +
          'You can set `giteaApiUrl` instead to give the full API address. There is no default, because Gitea has no standard host.',
      };
    }
    if (c.problem === 'repository-url') {
      return {
        message: `The repository URL ${c.value} does not contain an owner and a repository name.`,
        details:
          'Set the `repositoryUrl` option of semantic-release to a URL such as `https://git.example/owner/repo.git` or `git@git.example:owner/repo.git`. ' +
          'If Gitea is installed under a sub-path, set `giteaUrl` to include that sub-path so the plugin can tell it apart from the owner.',
      };
    }
    return {
      message: `The \`${c.option}\` option is not a usable Gitea URL: ${c.value}.`,
      details: `Set \`${c.option}\` to ${EXPECTED[c.option] ?? 'an absolute http or https URL'}. A username or password in the URL is not accepted; the token comes from the \`GITEA_TOKEN\` environment variable.`,
    };
  },
  ENOGITEATOKEN: () => ({
    message: 'No Gitea token is set.',
    details:
      'Set the `GITEA_TOKEN` environment variable to a Gitea access token that can write to the repository. ' +
      'The token is read only from the environment, so it never ends up in a committed config file. ' +
      'In Gitea Actions the built-in token is not an environment variable. Map it in the workflow with `env: GITEA_TOKEN: ${{ gitea.token }}`, or use a secret you created.',
  }),
  EINVALIDGITEATOKEN: (c) => ({
    message: `The Gitea token was rejected for ${c.owner}/${c.repo}.`,
    details: 'The server answered 401. Check that `GITEA_TOKEN` holds a valid, unexpired access token for this Gitea server, and that it is not a token from another service.',
  }),
  EMISSINGREPO: (c) => ({
    message: `The repository ${c.owner}/${c.repo} was not found on the Gitea server.`,
    details:
      'Check that the owner and repository name in `repositoryUrl` are right, that the repository was not renamed or moved, and that the token can see it. Gitea answers 404 for a private repository the token cannot read.',
  }),
  EGITEANOPERMISSION: (c) => ({
    message: `The Gitea token cannot push to ${c.owner}/${c.repo}.`,
    details: 'Releases need write access. Give the token owner write access to the repository, or use a token with the `write:repository` and `write:issue` scopes.',
  }),
  EMISMATCHGITEAURL: (c) => ({
    message: `The repository URL ${c.repositoryUrl} does not match the repository Gitea reports, ${c.clone_url}.`,
    details: 'The repository was probably renamed or transferred. Update `repositoryUrl` in the semantic-release config and the `origin` remote to the new address.',
  }),
  EUNSUPPORTEDOPTION: (c) =>
    c.option === 'giteaToken'
      ? {
          message: 'The `giteaToken` option is not supported.',
          details: 'The token is read only from the `GITEA_TOKEN` environment variable, so that it cannot end up in a committed config file. Remove the option and set the variable.',
        }
      : {
          message: `The \`${c.option}\` option is not supported on Gitea.`,
          details: `Gitea has no equivalent of \`${c.option}\`, so the plugin cannot do what it asks. Remove the option, or set it to \`false\`.`,
        },
  EUNSUPPORTEDGITEAVERSION: (c) => ({
    message: `The Gitea server version ${c.version} is not supported. Version ${MIN_GITEA_VERSION} or newer is required.`,
    details:
      `The plugin is tested against Gitea ${MIN_GITEA_VERSION} and newer. Upgrade the server. ` +
      'If the server reports a version this check cannot read, such as an empty answer or a web page, check that `giteaUrl` points at Gitea itself and not at a proxy or login page.',
  }),
  EMISSINGPROXYPACKAGE: () => ({
    message: 'A proxy is configured but the `undici` package is not installed.',
    details:
      'Requests through a proxy need the `undici` package. Install it next to semantic-release (`npm install undici`), or remove the `proxy` option and unset `http_proxy` and `HTTP_PROXY`.',
  }),
};

/**
 * Builds the error for a failed check, in the shape semantic-release prints.
 *
 * @param {string} code one of the plugin's `E…` codes
 * @param {Record<string, unknown>} [context] values to put in the message. A `token` key is never printed; it only lets the builder hide it.
 * @returns {SemanticReleaseError}
 */
export function getError(code, context = {}) {
  const { token, ...values } = context;
  /** @type {Record<string, string>} */
  const safe = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, show(value, token)]));

  let build = BUILDERS[code];
  if (!build && code.startsWith('EINVALID')) {
    build = (c) => ({
      message: `The \`${c.option}\` option is invalid: ${c.value}.`,
      details: `Set \`${c.option}\` to ${EXPECTED[c.option] ?? 'a valid value'}.`,
    });
  }
  if (!build) throw new Error(`Unknown error code ${code}`);

  const { message, details } = build(safe);
  return new SemanticReleaseError(message, code, details);
}
