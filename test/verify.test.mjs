import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../lib/verify.js';
import { GiteaApiError } from '../lib/client.js';
import { getError } from '../lib/definitions/errors.js';
import { fixture } from './support/server.mjs';

const TOKEN = 'tok-1234567890abcdef';
const REPO_URL = 'https://git.example/owner/repo.git';

/**
 * A stand-in for the client. `routes` maps "METHOD /path" to a body, or to an
 * Error to throw. Every call is recorded.
 * @param {Record<string, unknown>} routes
 */
function fakeCreateClient(routes) {
  /** @type {string[]} */
  const calls = [];
  /** @type {any[]} */
  const created = [];
  const createClient = (/** @type {any} */ options) => {
    created.push(options);
    return {
      paginate: async () => assert.fail('verify must not page'),
      request: async (/** @type {string} */ method, /** @type {string} */ path) => {
        calls.push(`${method} ${path}`);
        const answer = routes[`${method} ${path}`];
        if (answer instanceof Error) throw answer;
        if (answer === undefined) throw new GiteaApiError('no route', { method, path, status: 404 });
        return answer;
      },
    };
  };
  return { createClient: /** @type {any} */ (createClient), calls, created };
}

const apiError = (/** @type {number} */ status, method = 'GET', path = '/x') => new GiteaApiError(`failed with ${status}`, { method, path, status });
const GOOD_ROUTES = () => ({ 'GET /version': fixture('version').body, 'GET /repos/owner/repo': fixture('repo').body });

/**
 * @param {Record<string, unknown>} [overrides] merged into the context
 * @returns {any}
 */
function context(overrides = {}) {
  /** @type {string[]} */
  const logged = [];
  return {
    env: { GITEA_TOKEN: TOKEN, GITEA_URL: 'https://git.example' },
    options: { repositoryUrl: REPO_URL },
    logger: { log: (/** @type {string} */ message, /** @type {unknown[]} */ ...values) => logged.push([message, ...values].join(' ')) },
    logged,
    ...overrides,
  };
}

/** Runs verify and returns the codes of the errors it threw, or [] when it passed. */
async function codesFor(/** @type {any} */ pluginConfig, /** @type {any} */ ctx, /** @type {Record<string, unknown>} */ routes = GOOD_ROUTES()) {
  const { createClient, calls } = fakeCreateClient(routes);
  try {
    await verify(pluginConfig, ctx, { createClient });
    return { codes: /** @type {string[]} */ ([]), calls };
  } catch (error) {
    const e = /** @type {any} */ (error);
    if (!e.errors) throw error;
    return { codes: /** @type {string[]} */ ([...e.errors].map((x) => x.code)), calls, errors: /** @type {any[]} */ ([...e.errors]) };
  }
}

// --- the passing case ------------------------------------------------------

test('a valid setup returns the config, a client, the owner and the repo after exactly two requests', async () => {
  const { createClient, calls, created } = fakeCreateClient(GOOD_ROUTES());
  const ctx = context();
  const result = await verify({}, ctx, { createClient });
  assert.deepEqual(calls, ['GET /version', 'GET /repos/owner/repo']);
  assert.equal(result.owner, 'owner');
  assert.equal(result.repo, 'repo');
  assert.equal(result.config.apiBase, 'https://git.example/api/v1');
  assert.equal(typeof result.client.request, 'function');
  assert.equal(created[0].apiBase, 'https://git.example/api/v1');
  assert.equal(created[0].token, TOKEN);
  assert.deepEqual(ctx.logged, ['Verify Gitea authentication (%s) https://git.example/api/v1']);
});

// --- option validation -----------------------------------------------------

/** @type {Array<[string, unknown]>} */
const INVALID_OPTIONS = [
  ['proxy', 5],
  ['assets', [5]],
  ['successComment', ''],
  ['successCommentCondition', 5],
  ['failTitle', ''],
  ['failComment', 5],
  ['failCommentCondition', ['x']],
  ['labels', [5]],
  ['assignees', [5]],
  ['releasedLabels', ['']],
  ['addReleases', 'middle'],
  ['draftRelease', 'yes'],
  ['releaseBodyTemplate', ''],
  ['releaseNameTemplate', 5],
];

for (const [option, value] of INVALID_OPTIONS) {
  test(`${option}: ${JSON.stringify(value)} gives EINVALID${option.toUpperCase()} and nothing else`, async () => {
    const { codes } = await codesFor({ [option]: value }, context());
    assert.deepEqual(codes, [`EINVALID${option.toUpperCase()}`]);
  });
}

test('valid values for every option, including false to turn one off, pass', async () => {
  const { codes } = await codesFor(
    {
      proxy: false,
      assets: ['dist/*.tgz', { path: ['a', 'b'], label: 'x' }, ['c']],
      successComment: false,
      successCommentCondition: 'true',
      failTitle: 'failing',
      failComment: false,
      failCommentCondition: false,
      labels: false,
      assignees: ['me'],
      releasedLabels: false,
      addReleases: 'top',
      draftRelease: true,
      releaseBodyTemplate: '<%= nextRelease.notes %>',
      releaseNameTemplate: 'x',
    },
    context(),
  );
  assert.deepEqual(codes, []);
});

test('a proxy given as a host and a port is valid, and one without a port is not', async () => {
  assert.deepEqual((await codesFor({ proxy: { host: 'p.example', port: 3128 } }, context())).codes, []);
  assert.deepEqual((await codesFor({ proxy: { host: 'p.example' } }, context())).codes, ['EINVALIDPROXY']);
});

test('an invalid proxy stops verification before any request is made', async () => {
  const { calls } = await codesFor({ proxy: 5 }, context());
  assert.deepEqual(calls, []);
});

for (const [name, config, env] of /** @type {Array<[string, any, any]>} */ ([
  ['giteaUrl is not a URL', { giteaUrl: 'git.example' }, {}],
  ['giteaUrl is not http or https', { giteaUrl: 'ftp://git.example' }, {}],
  ['giteaUrl has a password', { giteaUrl: 'https://user:pw@git.example' }, {}],
  ['giteaUrl has a username', { giteaUrl: 'https://user@git.example' }, {}],
  ['GITEA_URL is not a URL', {}, { GITEA_URL: 'nonsense' }],
  ['giteaApiUrl is not a URL', { giteaApiUrl: 'nonsense' }, {}],
  ['giteaApiUrl has a password', { giteaApiUrl: 'https://u:p@git.example/api/v1' }, {}],
  ['giteaUrl is not a string', { giteaUrl: 42 }, {}],
])) {
  test(`EINVALIDGITEAURL when ${name}, and no request is made`, async () => {
    const ctx = context();
    ctx.env = { GITEA_TOKEN: TOKEN, ...env };
    const { codes, calls } = await codesFor(config, ctx);
    assert.ok(codes.includes('EINVALIDGITEAURL'), `got ${codes}`);
    assert.deepEqual(calls, []);
  });
}

test('an invalid giteaApiPrefix gives EINVALIDGITEAAPIPREFIX and no request is made', async () => {
  const { codes, calls } = await codesFor({ giteaApiPrefix: /** @type {any} */ (5) }, context());
  assert.deepEqual(codes, ['EINVALIDGITEAAPIPREFIX']);
  assert.deepEqual(calls, []);
});

// --- unsupported options ---------------------------------------------------

test('discussionCategoryName gives EUNSUPPORTEDOPTION that names it, but false does not', async () => {
  const { codes, errors } = await codesFor({ discussionCategoryName: 'Releases' }, context());
  assert.deepEqual(codes, ['EUNSUPPORTEDOPTION']);
  assert.match(errors?.[0].message, /discussionCategoryName/);
  assert.deepEqual((await codesFor({ discussionCategoryName: false }, context())).codes, []);
});

test('a giteaToken option gives EUNSUPPORTEDOPTION that points at GITEA_TOKEN, and the value is not printed', async () => {
  const { codes, errors } = await codesFor({ giteaToken: 'secret-from-config' }, context());
  assert.deepEqual(codes, ['EUNSUPPORTEDOPTION']);
  assert.match(errors?.[0].details, /GITEA_TOKEN/);
  assert.ok(!JSON.stringify(errors?.map((e) => [e.message, e.details])).includes('secret-from-config'));
});

// --- token, URL ------------------------------------------------------------

test('a missing or blank token gives ENOGITEATOKEN and no request is made', async () => {
  for (const env of [{ GITEA_URL: 'https://git.example' }, { GITEA_URL: 'https://git.example', GITEA_TOKEN: '   ' }]) {
    const ctx = context();
    ctx.env = env;
    const { codes, calls } = await codesFor({}, ctx);
    assert.deepEqual(codes, ['ENOGITEATOKEN']);
    assert.deepEqual(calls, []);
  }
});

test('no server URL and an unusable repository URL both give EINVALIDGITEAURL, with no request', async () => {
  const ctx = context();
  ctx.env = { GITEA_TOKEN: TOKEN };
  ctx.options.repositoryUrl = 'nonsense';
  const { codes, calls } = await codesFor({}, ctx);
  assert.deepEqual(codes, ['EINVALIDGITEAURL', 'EINVALIDGITEAURL']);
  assert.deepEqual(calls, []);
});

test('giteaApiUrl alone is enough, and the repository URL is read by its last two segments', async () => {
  const ctx = context();
  ctx.env = { GITEA_TOKEN: TOKEN };
  const { createClient, created } = (() => {
    const fake = fakeCreateClient(GOOD_ROUTES());
    return { createClient: fake.createClient, created: fake.created };
  })();
  await verify({ giteaApiUrl: 'https://git.example/api/v1/' }, ctx, { createClient });
  assert.equal(created[0].apiBase, 'https://git.example/api/v1');
});

test('an SSH remote without the sub-path passes when the server is under a sub-path', async () => {
  const ctx = context();
  ctx.env = { GITEA_TOKEN: TOKEN, GITEA_URL: 'https://git.example/gitea' };
  ctx.options.repositoryUrl = 'git@git.example:owner/repo.git';
  assert.deepEqual((await codesFor({}, ctx)).codes, []);
});

// --- server version --------------------------------------------------------

for (const [version, ok] of /** @type {Array<[string, boolean]>} */ ([
  ['28.2.0', true],
  ['28.10.1+dirty', true],
  ['29.0.0-rc.1', true],
  ['v30.1.2', true],
  ['28.1.9', false],
  ['27.99.99', false],
  ['1.22.0', false],
  ['nonsense', false],
])) {
  test(`server version ${version} ${ok ? 'passes' : 'gives EUNSUPPORTEDGITEAVERSION'}`, async () => {
    const { codes } = await codesFor({}, context(), { ...GOOD_ROUTES(), 'GET /version': { version } });
    assert.deepEqual(codes, ok ? [] : ['EUNSUPPORTEDGITEAVERSION']);
  });
}

test('a version answer that is not an object, or has no version, gives EUNSUPPORTEDGITEAVERSION', async () => {
  for (const answer of ['<html>login</html>', null, {}, { version: 28 }]) {
    const { codes } = await codesFor({}, context(), { ...GOOD_ROUTES(), 'GET /version': answer });
    assert.deepEqual(codes, ['EUNSUPPORTEDGITEAVERSION'], JSON.stringify(answer));
  }
});

test('a 401 on the version call gives EINVALIDGITEATOKEN and the repository is not requested', async () => {
  const { codes, calls } = await codesFor({}, context(), { ...GOOD_ROUTES(), 'GET /version': apiError(401, 'GET', '/version') });
  assert.deepEqual(codes, ['EINVALIDGITEATOKEN']);
  assert.deepEqual(calls, ['GET /version']);
});

test('a missing proxy package found on the first request is reported and the repository is not requested', async () => {
  const missing = getError('EMISSINGPROXYPACKAGE', { proxy: 'http://proxy.example:3128' });
  const { codes, calls } = await codesFor({ proxy: 'http://proxy.example:3128' }, context(), { 'GET /version': missing });
  assert.deepEqual(codes, ['EMISSINGPROXYPACKAGE']);
  assert.deepEqual(calls, ['GET /version']);
});

test('another failure on the version call is not a config error and is passed on unchanged', async () => {
  const failure = apiError(500, 'GET', '/version');
  await assert.rejects(verify({}, context(), { createClient: fakeCreateClient({ 'GET /version': failure }).createClient }), (error) => error === failure);
});

// --- repository ------------------------------------------------------------

test('a 401 on the repository gives EINVALIDGITEATOKEN and a 404 gives EMISSINGREPO', async () => {
  const base = GOOD_ROUTES();
  assert.deepEqual((await codesFor({}, context(), { ...base, 'GET /repos/owner/repo': apiError(401) })).codes, ['EINVALIDGITEATOKEN']);
  assert.deepEqual((await codesFor({}, context(), { ...base, 'GET /repos/owner/repo': apiError(404) })).codes, ['EMISSINGREPO']);
});

test('another failure on the repository call is passed on unchanged', async () => {
  const failure = apiError(500, 'GET', '/repos/owner/repo');
  const routes = { ...GOOD_ROUTES(), 'GET /repos/owner/repo': failure };
  await assert.rejects(verify({}, context(), { createClient: fakeCreateClient(routes).createClient }), (error) => error === failure);
});

test('a clone_url for another repository gives EMISMATCHGITEAURL, but a different letter case does not', async () => {
  const repo = /** @type {any} */ (fixture('repo').body);
  const base = GOOD_ROUTES();
  const renamed = { ...repo, clone_url: 'https://gitea.example/owner/renamed.git' };
  assert.deepEqual((await codesFor({}, context(), { ...base, 'GET /repos/owner/repo': renamed })).codes, ['EMISMATCHGITEAURL']);
  const cased = { ...repo, clone_url: 'https://gitea.example/Owner/Repo.git' };
  assert.deepEqual((await codesFor({}, context(), { ...base, 'GET /repos/owner/repo': cased })).codes, []);
});

test('a clone_url that gitea serves from a sub-path is still matched by owner and repo', async () => {
  const repo = /** @type {any} */ (fixture('repo').body);
  const routes = { ...GOOD_ROUTES(), 'GET /repos/owner/repo': { ...repo, clone_url: 'https://gitea.example/gitea/owner/repo.git' } };
  assert.deepEqual((await codesFor({}, context(), routes)).codes, []);
});

test('a repository answer without clone_url gives EMISMATCHGITEAURL', async () => {
  const routes = { ...GOOD_ROUTES(), 'GET /repos/owner/repo': { permissions: { push: true } } };
  assert.deepEqual((await codesFor({}, context(), routes)).codes, ['EMISMATCHGITEAURL']);
});

test('a token that cannot push gives EGITEANOPERMISSION, also when it is missing from the answer and also under Gitea Actions', async () => {
  const repo = /** @type {any} */ (fixture('repo').body);
  for (const permissions of [{ admin: false, push: false, pull: true }, {}, undefined]) {
    const ctx = context();
    ctx.env.GITEA_ACTIONS = 'true';
    ctx.env.GITHUB_ACTION = 'run';
    const routes = { ...GOOD_ROUTES(), 'GET /repos/owner/repo': { ...repo, permissions } };
    assert.deepEqual((await codesFor({}, ctx, routes)).codes, ['EGITEANOPERMISSION'], JSON.stringify(permissions));
  }
});

// --- collecting errors, the publish entry ---------------------------------

test('every problem found is thrown together in one AggregateError', async () => {
  const ctx = context();
  ctx.env = { GITEA_URL: 'https://git.example' };
  const { codes } = await codesFor({ labels: [5], discussionCategoryName: 'Releases' }, ctx);
  assert.deepEqual([...codes].sort(), ['EINVALIDLABELS', 'ENOGITEATOKEN', 'EUNSUPPORTEDOPTION']);
});

test('problems from the server checks are collected with the config problems that did not block them', async () => {
  const repo = /** @type {any} */ (fixture('repo').body);
  const routes = { 'GET /version': { version: '27.0.0' }, 'GET /repos/owner/repo': { ...repo, permissions: { push: false } } };
  const { codes } = await codesFor({ labels: [5] }, context(), routes);
  assert.deepEqual([...codes].sort(), ['EGITEANOPERMISSION', 'EINVALIDLABELS', 'EUNSUPPORTEDGITEAVERSION']);
});

test('the log line and the errors never show URL credentials or the token', async () => {
  const ctx = context();
  ctx.options.repositoryUrl = 'https://user:pw@git.example/owner/repo.git';
  ctx.env.GITEA_URL = 'https://git.example';
  const { createClient } = fakeCreateClient({ 'GET /version': { version: '28.2.0' }, 'GET /repos/owner/repo': { .../** @type {any} */ (fixture('repo').body), clone_url: 'https://user:pw@git.example/x/y.git' } });
  await assert.rejects(verify({ proxy: 'http://u:hunter2@p.example:1' }, ctx, { createClient }), (/** @type {any} */ error) => {
    const text = JSON.stringify([...error.errors].map((e) => [e.message, e.details])) + ctx.logged.join('\n');
    assert.ok(!text.includes('pw@') && !text.includes('hunter2') && !text.includes(TOKEN), text);
    return true;
  });
});
