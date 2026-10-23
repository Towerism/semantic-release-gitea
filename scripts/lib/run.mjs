// Runs the Gitea API checks (issue #3) against the server named in the
// environment and returns scrubbed observations. See docs/gitea-api-verification.md
// for what each check is for.
import { createClient } from './client.mjs';
import { checkBaseUrl, staleRepos, TEST_USER } from './guard.mjs';

const MERGE_STYLES = [
  { style: 'merge-commit', Do: 'merge' },
  { style: 'squash', Do: 'squash' },
  { style: 'rebase', Do: 'rebase' },
];
const MERGE_RETRIES = 10;
const MERGE_WAIT_MS = 1000;
const MARKER = '<!-- sr-e2e-marker -->';

const b64 = (text) => Buffer.from(text).toString('base64');
const summary = (r) => ({ status: r.status, ...(r.error ? { error: r.error } : {}), body: r.body });
const statusOnly = (r) => ({ status: r.status, ...(r.error ? { error: r.error } : {}) });

export async function run({
  env,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (line) => process.stdout.write(`${line}\n`),
  warn = (line) => process.stderr.write(`${line}\n`),
  fetchImpl = fetch,
  makeSignal,
}) {
  for (const name of ['GITEA_E2E_URL', 'GITEA_E2E_TOKEN']) {
    if (!env[name]) {
      warn(`${name} is not set`);
      return { exitCode: 2, results: [] };
    }
  }
  let base;
  try {
    base = checkBaseUrl(env.GITEA_E2E_URL);
  } catch (error) {
    warn(error.message);
    return { exitCode: 2, results: [] };
  }
  const token = env.GITEA_E2E_TOKEN;
  const client = createClient({ baseUrl: base.origin, token, fetchImpl, makeSignal });
  const call = client.request;

  const user = await call('GET', '/user', { internal: true });
  if (user.status !== 200 || user.body?.login !== TEST_USER) {
    warn(`the token does not belong to the ${TEST_USER} user (status ${user.status})`);
    return { exitCode: 2, results: [] };
  }

  const results = [];
  let exitCode = 0;
  const record = (check, observed, note) => results.push({ check, ok: true, observed, ...(note ? { note } : {}) });
  async function step(check, fn) {
    try {
      await fn();
    } catch (error) {
      results.push({ check, ok: false, observed: client.scrub(error), note: 'the check threw' });
    }
  }

  await removeStaleRepos();

  const repo = `sr-e2e-${now()}`;
  const created = await call('POST', '/user/repos', {
    json: { name: repo, auto_init: true, default_branch: 'main', private: true },
  });
  if (created.status !== 201) {
    results.push({ check: 2, ok: false, observed: summary(created), note: 'the test repository could not be created' });
    log(JSON.stringify({ results }, null, 2));
    return { exitCode: 1, results };
  }

  const api = (method, path, options) => call(method, `/repos/${TEST_USER}/${repo}${path}`, options);

  try {
    await step(1, async () => {
      const version = await call('GET', '/version');
      record(1, { status: version.status, version: version.body?.version ?? null, body: version.body });
    });
    await step(2, checkRepoPermissions);
    await step(3, checkReleases);
    const labels = {};
    await step(4, () => checkLabels(labels));
    await step(5, () => checkIssueSearch(labels));
    await step(6, checkPullRequests);
    await step(9, checkErrorsAndLimits);
    record(10, null, 'needs a Gitea Actions workflow run, which this script cannot observe; the result is recorded by hand in the document');
  } finally {
    const removed = await call('DELETE', `/repos/${TEST_USER}/${repo}`);
    if (removed.status !== 204) {
      exitCode = 1;
      warn(`could not delete ${repo}`);
    }
    log(JSON.stringify({ results, cleanup: { repo, status: removed.status } }, null, 2));
  }
  return { exitCode, results };

  async function removeStaleRepos() {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const listed = await call('GET', `/user/repos?limit=50&page=${page}`, { internal: true });
      if (listed.status !== 200 || !Array.isArray(listed.body)) break;
      all.push(...listed.body);
      if (listed.body.length < 50) break;
    }
    for (const name of staleRepos(all, now())) {
      const removed = await call('DELETE', `/repos/${TEST_USER}/${name}`);
      if (removed.status !== 204) warn(`could not delete stale repository ${name}`);
    }
  }

  async function checkRepoPermissions() {
    const r = await api('GET', '');
    record(2, {
      status: r.status,
      permissions: r.body?.permissions ?? null,
      hasCloneUrl: typeof r.body?.clone_url === 'string',
      cloneUrlShape: r.body?.clone_url ?? null,
    });
  }

  async function checkReleases() {
    const tag = 'v0.0.1-e2e';
    const observed = {};
    const draft = await api('POST', '/releases', {
      json: { tag_name: tag, target_commitish: 'main', name: tag, body: 'e2e', draft: true, prerelease: false },
    });
    observed.createDraft = summary(draft);
    const id = draft.body?.id;
    observed.fetchDraftByTag = statusOnly(await api('GET', `/releases/tags/${tag}`));
    if (id) {
      observed.upload = {};
      for (const field of ['attachment', 'file']) {
        const form = new FormData();
        form.append(field, new Blob(['hello'], { type: 'text/plain' }), `${field}.txt`);
        observed.upload[field] = summary(await api('POST', `/releases/${id}/assets?name=${field}.txt`, { body: form }));
      }
      observed.publish = summary(await api('PATCH', `/releases/${id}`, { json: { draft: false } }));
      observed.fetchPublishedByTag = summary(await api('GET', `/releases/tags/${tag}`));
      observed.markPrerelease = summary(await api('PATCH', `/releases/${id}`, { json: { prerelease: true } }));
      observed.latest = statusOnly(await api('GET', '/releases/latest'));
    }
    record(3, observed);
  }

  async function checkLabels(labels) {
    const observed = {};
    const withHash = await api('POST', '/labels', { json: { name: 'sr-hash', color: '#ee0701' } });
    const withoutHash = await api('POST', '/labels', { json: { name: 'sr-nohash', color: 'ee0701' } });
    observed.createColour = { withHash: summary(withHash), withoutHash: summary(withoutHash) };
    labels.byId = withHash.body?.id ?? withoutHash.body?.id;
    labels.name = withHash.body?.id ? 'sr-hash' : 'sr-nohash';

    const byIds = await api('POST', '/issues', { json: { title: 'labels by id', body: MARKER, labels: [labels.byId] } });
    observed.issueCreateLabelIds = { status: byIds.status, labels: byIds.body?.labels ?? null };
    const byNames = await api('POST', '/issues', { json: { title: 'labels by name', body: 'x', labels: [labels.name] } });
    observed.issueCreateLabelNames = { status: byNames.status, labels: byNames.body?.labels ?? null, body: byNames.status >= 400 ? byNames.body : undefined };
    labels.issue = byIds.body?.number ?? byNames.body?.number;
    if (labels.issue) {
      const addNames = await api('POST', `/issues/${labels.issue}/labels`, { json: { labels: [labels.name] } });
      observed.addLabelsByName = { status: addNames.status, body: addNames.body };
      const addIds = await api('POST', `/issues/${labels.issue}/labels`, { json: { labels: [labels.byId] } });
      observed.addLabelsById = { status: addIds.status };
    }
    record(4, observed);
  }

  async function checkIssueSearch(labels) {
    const observed = {};
    const byLabel = await api('GET', `/issues?state=open&type=issues&labels=${labels.name}`);
    observed.byLabel = { status: byLabel.status, count: Array.isArray(byLabel.body) ? byLabel.body.length : null };
    const byQuery = await api('GET', '/issues?state=open&type=issues&q=sr-e2e-marker');
    observed.byQueryParam = { status: byQuery.status, count: Array.isArray(byQuery.body) ? byQuery.body.length : null };
    const all = await api('GET', '/issues?state=open&type=issues&limit=50');
    observed.fetchAndFilter = {
      status: all.status,
      matches: Array.isArray(all.body) ? all.body.filter((i) => i.body?.includes(MARKER)).length : null,
    };
    record(5, observed);
  }

  async function checkPullRequests() {
    const observed = { settings: null, styles: [] };
    observed.settings = statusOnly(await api('PATCH', '', {
      json: { allow_merge_commits: true, allow_squash_merge: true, allow_rebase: true, allow_rebase_explicit: true },
    }));
    const baseCommits = async () => {
      const r = await api('GET', '/commits?sha=main&limit=30&stat=false&verification=false&files=false');
      return Array.isArray(r.body) ? r.body.map((c) => c.sha) : [];
    };
    const prs = [];
    for (const { style, Do } of MERGE_STYLES) {
      const branch = `sr-pr-${style}`;
      const first = await api('POST', `/contents/${style}-1.txt`, {
        json: { content: b64('one'), message: `${style} one`, branch: 'main', new_branch: branch },
      });
      const second = await api('POST', `/contents/${style}-2.txt`, {
        json: { content: b64('two'), message: `${style} two`, branch },
      });
      const pr = await api('POST', '/pulls', { json: { head: branch, base: 'main', title: `${style} pull request` } });
      prs.push({ style, Do, number: pr.body?.number, setup: { first: first.status, second: second.status, pr: pr.status } });
    }

    const first = prs.find((p) => p.number);
    if (first) {
      const comment = await api('POST', `/issues/${first.number}/comments`, { json: { body: 'e2e comment' } });
      record(7, { status: comment.status, body: comment.body });
    } else {
      record(7, null, 'not run: no pull request could be created');
    }

    for (const pr of prs) {
      const entry = { style: pr.style, setup: pr.setup };
      if (!pr.number) {
        observed.styles.push(entry);
        continue;
      }
      const branchList = await api('GET', `/pulls/${pr.number}/commits`);
      const branchShas = Array.isArray(branchList.body) ? branchList.body.map((c) => c.sha) : [];
      const before = new Set(await baseCommits());
      let merge;
      for (let attempt = 0; attempt < MERGE_RETRIES; attempt++) {
        merge = await api('POST', `/pulls/${pr.number}/merge`, { json: { Do: pr.Do } });
        if (merge.status === 200) break;
        await sleep(MERGE_WAIT_MS);
      }
      entry.merge = statusOnly(merge);
      const after = await baseCommits();
      const lookup = async (sha) => {
        const r = await api('GET', `/commits/${sha}/pull`);
        return { sha, status: r.status, pull: r.status === 200 ? (r.body?.number ?? 'none') : 'none' };
      };
      entry.branchCommits = [];
      for (const sha of branchShas) entry.branchCommits.push(await lookup(sha));
      entry.baseCommits = [];
      for (const sha of after.filter((s) => !before.has(s))) entry.baseCommits.push(await lookup(sha));
      observed.styles.push(entry);
    }
    record(6, observed);
  }

  async function checkErrorsAndLimits() {
    const observed = {};
    const ok = await api('GET', '');
    observed.normalHeaders = { status: ok.status, headers: ok.headers };
    const missing = await api('GET', '/does-not-exist');
    observed.notFound = summary(missing);
    const anonymous = createClient({ baseUrl: base.origin, token: 'invalid-token', fetchImpl, makeSignal });
    observed.badToken = summary(await anonymous.request('GET', '/user'));
    observed.rateLimitAndServerErrors = 'not provoked: the server is a personal one, so no load is generated to force a 429 or 5xx';
    record(9, observed);
  }
}
