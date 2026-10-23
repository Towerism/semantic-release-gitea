import { template } from 'lodash-es';
import { conditionPasses } from './condition.js';
import { FAILURE_LABEL, FAILURE_MARKER } from './definitions/constants.js';
import { findFailureIssues } from './failure-issues.js';
import { ensureLabels } from './labels.js';
import { redact } from './redact.js';
import { VALIDATORS } from './verify.js';

const DEFAULT_TITLE = 'The automated release is failing 🚨';
const DEFAULT_LABELS = [FAILURE_LABEL];
const SEMANTIC_RELEASE_DOCS = 'https://github.com/semantic-release/semantic-release/blob/master/docs';

/**
 * @typedef {{ config: ReturnType<typeof import('./resolve-config.js').resolveConfig>, client: import('./client.js').GiteaClient, owner: string, repo: string }} Connection
 */

/**
 * Opens an issue for a failed release, or comments on the one that is already
 * open. This step does not run the checks of `verifyConditions`: the failures
 * most worth reporting are the ones those checks find (ADR-0008).
 *
 * @param {Connection} connection
 * @param {import('../index.js').Context} context
 * @returns {Promise<void>}
 */
export async function fail({ config, client, owner, repo }, context) {
  const { branch, errors = [], logger } = context;
  const options = withDefaults(config, logger);

  if (options.failComment === false || options.failTitle === false || options.failCommentCondition === false) {
    logger.log('Skip issue creation.');
    return;
  }

  const labels = options.labels === false ? [] : options.labels;
  const [failureIssue] = await findFailureIssues(client, owner, repo);

  /** @type {string[]} */
  const problems = [];
  const problem = (/** @type {string} */ option, /** @type {unknown} */ error) => {
    const reason = redact(error instanceof Error ? error.message : String(error), [config.giteaToken]);
    logger.error('The %s template failed: %s', option, reason);
    problems.push(`### The \`${option}\` template failed\n\n${reason}`);
  };

  let allowed = true;
  if (options.failCommentCondition) {
    try {
      allowed = conditionPasses(template(options.failCommentCondition)({ ...context, issue: failureIssue }));
    } catch (error) {
      problem('failCommentCondition', error);
    }
  }
  if (!allowed) {
    logger.log('Skip commenting on or creating an issue.');
    return;
  }

  /** @type {string | undefined} */
  let text;
  if (options.failComment) {
    try {
      text = template(options.failComment)({ branch, errors });
    } catch (error) {
      problem('failComment', error);
    }
  }
  const comment = redact(text ?? defaultComment(branch, errors, problems), [config.giteaToken]);

  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`;
  if (failureIssue) {
    logger.log('Found existing semantic-release issue #%d.', failureIssue.number);
    const added = /** @type {{ html_url: string }} */ (await client.request('POST', `${base}/${failureIssue.number}/comments`, { json: { body: comment } }));
    logger.log('Added comment to issue #%d: %s.', failureIssue.number, added.html_url);
    return;
  }

  const labelIds = await ensureLabels(client, owner, repo, [...new Set([...labels, FAILURE_LABEL])]);
  const created = /** @type {{ number: number, html_url: string }} */ (
    await client.request('POST', base, {
      json: {
        title: redact(options.failTitle, [config.giteaToken]),
        body: `${comment}\n\n${FAILURE_MARKER}`,
        labels: labelIds,
        ...(options.assignees ? { assignees: options.assignees } : {}),
      },
    })
  );
  logger.log('Created issue #%d: %s.', created.number, created.html_url);
}

/**
 * Replaces an option of the wrong type with its default. Verification would
 * have reported it; this step runs without verification, and a bad option
 * must not stop the failure from being reported.
 *
 * @param {Connection['config']} config
 * @param {import('../index.js').Logger} logger
 */
function withDefaults(config, logger) {
  const defaults = /** @type {const} */ ({
    failTitle: DEFAULT_TITLE,
    failComment: undefined,
    failCommentCondition: undefined,
    labels: DEFAULT_LABELS,
    assignees: undefined,
  });
  const values = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (config));
  /** @type {Record<string, unknown>} */
  const result = {};
  for (const [option, fallback] of Object.entries(defaults)) {
    const value = values[option];
    const valid = /** @type {Record<string, (value: unknown) => boolean>} */ (VALIDATORS)[option];
    if (value !== undefined && value !== null && !valid(value)) {
      logger.warn('The %s option is not valid, so its default is used instead.', option);
      result[option] = fallback;
    } else {
      result[option] = value ?? fallback;
    }
  }
  return /** @type {{ failTitle: string | false, failComment: string | false | undefined, failCommentCondition: string | false | undefined, labels: string[] | false, assignees: string[] | undefined }} */ (
    result
  );
}

/**
 * The text used when `failComment` is not set, or its template failed.
 *
 * @param {{ name?: string } | undefined} branch
 * @param {Array<Error & { details?: string, pluginName?: string }>} errors
 * @param {string[]} problems sections describing templates that failed
 * @returns {string}
 */
function defaultComment(branch, errors, problems) {
  const name = branch?.name ?? 'release';
  const sections = errors.map(
    (error) =>
      `### ${error.message}\n\n${
        error.details ??
        `This error has no further details.${error.pluginName ? ` The \`${error.pluginName}\` plugin reported it, so its author may be able to add some.` : ''}`
      }`,
  );
  return [
    `## The automated release from the \`${name}\` branch failed`,
    `semantic-release stopped before it could publish. Each error below has to be fixed before the next release can go out. When they are fixed, push a commit to \`${name}\` or run the failed job again.`,
    `Help: [usage](${SEMANTIC_RELEASE_DOCS}/usage/README.md), [FAQ](${SEMANTIC_RELEASE_DOCS}/support/FAQ.md).`,
    '---',
    [...problems, ...sections].join('\n\n---\n\n') || 'semantic-release reported no errors.',
  ].join('\n\n');
}
