import AggregateError from 'aggregate-error';
import issueParser from 'issue-parser';
import { template } from 'lodash-es';
import { GiteaApiError } from './client.js';
import { MAX_IN_FLIGHT, RELEASE_NAME } from './definitions/constants.js';
import { findFailureIssues } from './failure-issues.js';
import { ensureLabels } from './labels.js';
import { createLimiter, limitClient } from './limit.js';
import { redact } from './redact.js';

const SEMANTIC_RELEASE_HOME = 'https://github.com/semantic-release/semantic-release';

/**
 * What Gitea sends for a pull request or an issue. Only the fields this step reads are listed.
 * @typedef {{ number: number, body?: string | null, merged?: boolean, merge_commit_sha?: string | null, pull_request?: unknown }} Item
 * @typedef {{ config: ReturnType<typeof import('./resolve-config.js').resolveConfig>, client: import('./client.js').GiteaClient, owner: string, repo: string }} Connection
 */

/**
 * Comments on the pull requests and issues a release contains, labels them,
 * closes the open failure issues, and lists the other releases in the
 * release notes. A failure on one item does not stop the others: errors are
 * collected and thrown together at the end.
 *
 * @param {Connection} connection
 * @param {import('../index.js').Context} context
 * @returns {Promise<void>}
 */
export async function success({ config, client: rawClient, owner, repo }, context) {
  const { logger, commits = [] } = context;
  const client = limitClient(rawClient, createLimiter(MAX_IN_FLIGHT));
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  /** @type {Error[]} */
  const errors = [];
  /** @param {unknown} error */
  const collect = (error) => void errors.push(error instanceof Error ? error : new Error(String(error)));
  const steps = { config, client, owner, repo, base, context, collect };

  if (config.successComment === false || commits.length === 0) {
    if (commits.length === 0) logger.log('No commits found in release');
    logger.log('Skip commenting on issues and pull requests.');
  } else if (config.successCommentCondition === false) {
    logger.log('Skip commenting on issues and pull requests.');
  } else {
    await commentOnReleased(steps);
  }

  if (config.failComment === false || config.failTitle === false || config.failCommentCondition === false) {
    logger.log('Skip closing issue.');
  } else {
    await closeFailureIssues(steps);
  }

  if (config.addReleases !== false && errors.length === 0) {
    try {
      await listOtherReleases(steps);
    } catch (error) {
      collect(error);
    }
  }

  if (errors.length > 0) throw new AggregateError(errors);
}

/**
 * @typedef {{ config: Connection['config'], client: import('./client.js').GiteaClient, owner: string, repo: string, base: string, context: import('../index.js').Context, collect: (error: unknown) => void }} Steps
 */

/** @param {unknown} error */
const isNotFound = (error) => error instanceof GiteaApiError && error.status === 404;

/**
 * @param {Steps} steps
 */
async function commentOnReleased(steps) {
  const { config, client, owner, repo, base, context, collect } = steps;
  const { logger, nextRelease } = context;

  const pulls = await findPullRequests(steps);
  const issues = await findIssues(steps, pulls);
  /** @type {Item[]} */
  const items = [
    ...[...pulls.values()].sort((a, b) => a.number - b.number).map((pr) => ({ ...pr, pull_request: pr.pull_request ?? { merged: Boolean(pr.merged) } })),
    ...issues,
  ];
  logger.log('Found %d pull requests and issues to comment on.', items.length);

  /** @type {string[]} */
  let labelNames = [];
  if (Array.isArray(config.releasedLabels)) {
    try {
      labelNames = config.releasedLabels.map((label) => template(label)(context).trim()).filter(Boolean);
    } catch (error) {
      collect(error);
    }
  }
  /** @type {Promise<number[]> | undefined} */
  let pendingLabels;
  // Labels are looked up once, on the first item that is commented, and not at all when nothing is.
  const labelIds = () =>
    (pendingLabels ??= ensureLabels(client, owner, repo, labelNames).catch((error) => {
      collect(error);
      logger.error('Failed to find or create the labels %O.', labelNames);
      throw error;
    }));
  const releaseInfos = (context.releases ?? []).filter((release) => Boolean(release.name));

  await Promise.all(
    items.map(async (issue) => {
      const kind = issue.pull_request ? 'PR' : 'issue';
      /** @type {string} */
      let text;
      try {
        if (config.successCommentCondition && !template(config.successCommentCondition)({ ...context, issue })) {
          logger.log(`Skip commenting on ${kind} #%d.`, issue.number);
          return;
        }
        text = config.successComment
          ? template(config.successComment)({ ...context, issue })
          : defaultComment(kind, nextRelease?.version, releaseInfos);
      } catch (error) {
        collect(error);
        logger.error(`Failed to render the comment for ${kind} #%d.`, issue.number);
        return;
      }

      try {
        const added = /** @type {{ html_url: string }} */ (
          await client.request('POST', `${base}/issues/${issue.number}/comments`, { json: { body: redact(text, [config.giteaToken]) } })
        );
        logger.log(`Added comment to ${kind} #%d: %s`, issue.number, added.html_url);
      } catch (error) {
        if (error instanceof GiteaApiError && error.status === 403) {
          logger.error('Not allowed to add a comment to the issue/PR #%d.', issue.number);
        } else if (isNotFound(error)) {
          logger.error("Failed to add a comment to the issue/PR #%d as it doesn't exist.", issue.number);
        } else {
          collect(error);
          logger.error('Failed to add a comment to the issue/PR #%d.', issue.number);
        }
        return;
      }

      if (labelNames.length === 0) return;
      /** @type {number[]} */
      let ids;
      try {
        ids = await labelIds();
      } catch {
        return; // collected where it happened, once for the whole run
      }
      try {
        await client.request('POST', `${base}/issues/${issue.number}/labels`, { json: { labels: ids } });
        logger.log(`Added labels %O to ${kind} #%d`, labelNames, issue.number);
      } catch (error) {
        collect(error);
        logger.error(`Failed to add labels to ${kind} #%d.`, issue.number);
      }
    }),
  );
}

/**
 * Finds the merged pull requests the release contains: those Gitea links to a
 * released commit, and those named by a `(#N)` at the end of a commit subject
 * that really are in the release.
 *
 * @param {Steps} steps
 * @returns {Promise<Map<number, Item>>}
 */
async function findPullRequests({ client, base, context, collect }) {
  const commits = context.commits ?? [];
  const released = new Set(commits.map(({ hash }) => hash));
  /** @type {Map<number, Item>} */
  const pulls = new Map();

  // The lookup answers only for the commit the merge recorded, and that commit is in the release, so its pull request is kept as it is.
  await Promise.all(
    commits.map(async ({ hash }) => {
      try {
        const found = /** @type {Item} */ (await client.request('GET', `${base}/commits/${hash}/pull`));
        if (typeof found?.number === 'number') pulls.set(found.number, found);
      } catch (error) {
        if (!isNotFound(error)) collect(error);
      }
    }),
  );

  const referenced = new Set(
    commits.flatMap(({ message }) => {
      const match = /\(#(\d+)\)\s*$/.exec(String(message).split('\n')[0]);
      return match ? [Number(match[1])] : [];
    }),
  );
  await Promise.all(
    [...referenced]
      .filter((number) => !pulls.has(number))
      .map(async (number) => {
        try {
          const found = /** @type {Item} */ (await client.request('GET', `${base}/pulls/${number}`));
          if (!found.merged) return;
          let inRelease = typeof found.merge_commit_sha === 'string' && released.has(found.merge_commit_sha);
          if (!inRelease) {
            const own = /** @type {Array<{ sha: string }>} */ (await client.paginate(`${base}/pulls/${number}/commits`));
            inRelease = own.some(({ sha }) => released.has(sha));
          }
          if (inRelease) pulls.set(number, found);
        } catch (error) {
          // A 404 means the number is an issue, or nothing: the subject only mentions it.
          if (!isNotFound(error)) collect(error);
        }
      }),
  );
  return pulls;
}

/**
 * Finds the issues named by closing keywords in the kept pull requests and in
 * every released commit message, and fetches each once.
 *
 * @param {Steps} steps
 * @param {Map<number, Item>} pulls
 * @returns {Promise<Item[]>}
 */
async function findIssues({ config, client, owner, repo, base, context, collect }, pulls) {
  const { logger, commits = [] } = context;
  const server = config.giteaUrl || (config.apiBase ? new URL(config.apiBase).origin : '');
  const parse = issueParser('github', server ? { hosts: [server.replace(/\/+$/, '')] } : {});
  const thisRepo = `${owner}/${repo}`.toLowerCase();

  /** @type {Set<number>} */
  const numbers = new Set();
  for (const text of [...[...pulls.values()].map(({ body }) => body), ...commits.map(({ message }) => message)]) {
    if (!text) continue;
    for (const action of parse(text).actions.close) {
      if (!action.slug || action.slug.toLowerCase() === thisRepo) numbers.add(Number.parseInt(action.issue, 10));
    }
  }

  /** @type {Item[]} */
  const issues = [];
  await Promise.all(
    [...numbers]
      .filter((number) => !pulls.has(number))
      .map(async (number) => {
        try {
          issues.push(/** @type {Item} */ (await client.request('GET', `${base}/issues/${number}`)));
        } catch (error) {
          if (isNotFound(error)) logger.log('Skip #%d: it was not found.', number);
          else collect(error);
        }
      }),
  );
  return issues.sort((a, b) => a.number - b.number);
}

/**
 * @param {Steps} steps
 */
async function closeFailureIssues({ config, client, owner, repo, base, context, collect }) {
  const { logger } = context;
  try {
    const open = await findFailureIssues(client, owner, repo, Array.isArray(config.labels) ? config.labels : []);
    await Promise.all(
      open.map(async ({ number }) => {
        try {
          const closed = /** @type {{ html_url?: string }} */ (await client.request('PATCH', `${base}/issues/${number}`, { json: { state: 'closed' } }));
          logger.log('Closed issue #%d: %s.', number, closed?.html_url);
        } catch (error) {
          collect(error);
          logger.error('Failed to close the issue #%d.', number);
        }
      }),
    );
  } catch (error) {
    collect(error);
    logger.error('Failed to look for open failure issues.');
  }
}

/**
 * Adds links to the releases the other plugins made to this release's notes.
 *
 * @param {Steps} steps
 */
async function listOtherReleases({ config, client, base, context }) {
  const releases = context.releases ?? [];
  const own = releases.find((release) => release.name === RELEASE_NAME);
  const others = releases.filter((release) => release.name && release.name !== RELEASE_NAME);
  if (!own || own.id === undefined || own.id === null || others.length === 0) return;

  const links = `This release is also available on:\n${others.map((release) => `- ${linkify(release)}`).join('\n')}`;
  // The body that `publish` sent: it came from `releaseBodyTemplate`, not straight from the notes.
  const notes = template(config.releaseBodyTemplate)(context);
  const body = config.addReleases === 'top' ? `${links}\n---\n${notes}` : `${notes}\n---\n${links}`;
  await client.request('PATCH', `${base}/releases/${own.id}`, { json: { body } });
}

/** @param {{ name?: string, url?: string }} release */
function linkify(release) {
  if (!release.url) return `\`${release.name}\``;
  return release.url.startsWith('http') ? `[${release.name}](${release.url})` : `${release.name}: \`${release.url}\``;
}

/**
 * The text used when `successComment` is not set.
 *
 * @param {'PR' | 'issue'} kind
 * @param {string | undefined} version
 * @param {Array<{ name?: string, url?: string }>} releaseInfos
 */
function defaultComment(kind, version, releaseInfos) {
  const headline = `:tada: This ${kind === 'PR' ? 'PR is included' : 'issue has been resolved'} in version ${version} :tada:`;
  const available =
    releaseInfos.length === 0
      ? ''
      : releaseInfos.length === 1
        ? `\n\nThe release is available on ${linkifyDefault(releaseInfos[0])}`
        : `\n\nThe release is available on:\n${releaseInfos.map((release) => `- ${linkifyDefault(release)}`).join('\n')}`;
  return `${headline}${available}\n\nYour **[semantic-release](${SEMANTIC_RELEASE_HOME})** bot :package::rocket:`;
}

/** @param {{ name?: string, url?: string }} release */
const linkifyDefault = (release) => (release.url ? `[${release.name}](${release.url})` : `\`${release.name}\``);
