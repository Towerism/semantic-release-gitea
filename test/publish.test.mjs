import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish } from '../lib/publish.js';
import { GiteaApiError } from '../lib/client.js';
import { UPLOAD_TIMEOUT_MS } from '../lib/definitions/constants.js';
import { acceptingHandler, setup, RELEASE_URL, DOWNLOAD_URL } from './support/release-helpers.mjs';

const RELEASES = '/repos/o/r/releases';

/**
 * A folder holding two small text files, removed after the test.
 * @param {import('node:test').TestContext} t
 */
async function folderWithFiles(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'sr-gitea-publish-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'a.txt'), 'alpha');
  await writeFile(join(cwd, 'b.txt'), 'bravo');
  return cwd;
}

/** @param {{ method: string, path: string }[]} calls */
const summary = (calls) => calls.map(({ method, path }) => `${method} ${path}`);

// --- without assets -----------------------------------------------------------

test('without assets one request creates the release from the tag, the branch and the notes', async () => {
  const { verified, calls, context } = setup();
  await publish(verified, context);
  assert.deepEqual(summary(calls), [`POST ${RELEASES}`]);
  assert.deepEqual(calls[0].options.json, {
    tag_name: 'v1.2.0',
    target_commitish: 'main',
    name: '1.2.0',
    body: 'N',
    draft: false,
    prerelease: false,
  });
});

test('an empty assets list is treated as no assets', async () => {
  const { verified, calls, context } = setup({ config: { assets: [] } });
  await publish(verified, context);
  assert.equal(calls.length, 1);
});

test('the release name and body are rendered from the templates with the whole context', async () => {
  const { verified, calls, context } = setup({
    config: { releaseNameTemplate: 'v<%= nextRelease.version %> on <%= branch.name %>', releaseBodyTemplate: '<%= nextRelease.notes %>!' },
  });
  await publish(verified, context);
  assert.equal(calls[0].options.json.name, 'v1.2.0 on main');
  assert.equal(calls[0].options.json.body, 'N!');
});

test('a template that throws rejects with that error and sends no request', async () => {
  const { verified, calls, context } = setup({ config: { releaseBodyTemplate: '<%= missingValue.here %>' } });
  await assert.rejects(publish(verified, context), /missingValue/);
  assert.equal(calls.length, 0);
});

test('draftRelease creates a draft in one request and returns the draft address', async () => {
  const { verified, calls, context } = setup({ config: { draftRelease: true } });
  const result = await publish(verified, context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.json.draft, true);
  assert.equal(result.url, RELEASE_URL);
});

test('a release from a maintenance branch is marked as a pre-release', async () => {
  const { verified, calls, context } = setup({ context: { branch: { name: '1.x', type: 'release', main: false } } });
  await publish(verified, context);
  assert.equal(calls[0].options.json.prerelease, true);
});

test('a branch that says prerelease: false is never marked as a pre-release', async () => {
  const { verified, calls, context } = setup({ context: { branch: { name: '1.x', type: 'release', main: false, prerelease: false } } });
  await publish(verified, context);
  assert.equal(calls[0].options.json.prerelease, false);
});

test('the request never carries fields that Gitea does not define', async () => {
  const { verified, calls, context } = setup();
  await publish(verified, context);
  for (const call of calls) {
    assert.ok(!('make_latest' in (call.options.json ?? {})));
    assert.ok(!('discussion_category_name' in (call.options.json ?? {})));
  }
});

test('it returns the release address, the name "Gitea release" and the id, and logs the address', async () => {
  const { verified, context, lines } = setup();
  const result = await publish(verified, context);
  assert.deepEqual(result, { url: RELEASE_URL, name: 'Gitea release', id: 7 });
  assert.ok(lines.some(([level, message, value]) => level === 'log' && /Published Gitea release/.test(String(message)) && value === RELEASE_URL));
});

test('a draft is logged as a draft', async () => {
  const { verified, context, lines } = setup({ config: { draftRelease: true } });
  await publish(verified, context);
  assert.ok(lines.some(([level, message]) => level === 'log' && /Created Gitea draft release/.test(String(message))));
});

// --- with assets --------------------------------------------------------------

test('with assets it creates a draft, uploads each file one at a time, then publishes', async (t) => {
  const cwd = await folderWithFiles(t);
  const { verified, calls, context } = setup({ config: { assets: ['a.txt', 'b.txt'] }, context: { cwd } });
  const result = await publish(verified, context);

  assert.deepEqual(summary(calls), [`POST ${RELEASES}`, `POST ${RELEASES}/7/assets`, `POST ${RELEASES}/7/assets`, `PATCH ${RELEASES}/7`]);
  assert.equal(calls[0].options.json.draft, true);
  assert.deepEqual(calls[3].options.json, { draft: false });
  assert.deepEqual(result, { url: RELEASE_URL, name: 'Gitea release', id: 7 });

  const uploaded = [];
  for (const upload of calls.slice(1, 3)) {
    const form = upload.options.body;
    assert.ok(form instanceof FormData, 'the upload body is multipart');
    assert.deepEqual([...form.keys()], ['attachment']);
    const file = /** @type {File} */ (form.get('attachment'));
    uploaded.push([upload.options.query.name, await file.text()]);
  }
  assert.deepEqual(uploaded.sort(), [['a.txt', 'alpha'], ['b.txt', 'bravo']]);
});

test('uploads use the long upload limit and no other call sets a limit of its own', async (t) => {
  const cwd = await folderWithFiles(t);
  const { verified, calls, context } = setup({ config: { assets: ['a.txt'] }, context: { cwd } });
  await publish(verified, context);
  assert.deepEqual(
    calls.map((call) => call.options.timeoutMs),
    [undefined, UPLOAD_TIMEOUT_MS, undefined],
  );
  assert.equal(UPLOAD_TIMEOUT_MS, 10 * 60 * 1000);
});

test('each uploaded file is logged by its download address', async (t) => {
  const cwd = await folderWithFiles(t);
  const { verified, context, lines } = setup({ config: { assets: ['a.txt'] }, context: { cwd } });
  await publish(verified, context);
  assert.ok(lines.some(([level, , value]) => level === 'log' && value === DOWNLOAD_URL));
});

test('with draftRelease the assets are uploaded and the release stays a draft', async (t) => {
  const cwd = await folderWithFiles(t);
  const { verified, calls, context } = setup({ config: { assets: ['a.txt'], draftRelease: true }, context: { cwd } });
  const result = await publish(verified, context);
  assert.deepEqual(summary(calls), [`POST ${RELEASES}`, `POST ${RELEASES}/7/assets`]);
  assert.equal(result.url, RELEASE_URL);
});

test('when no listed asset can be read the draft is still created and then published', async (t) => {
  const cwd = await folderWithFiles(t);
  const { verified, calls, context, lines } = setup({ config: { assets: ['nothing-here.bin'] }, context: { cwd } });
  await publish(verified, context);
  assert.deepEqual(summary(calls), [`POST ${RELEASES}`, `PATCH ${RELEASES}/7`]);
  assert.ok(lines.some(([level]) => level === 'error'));
});

test('an upload that fails stops the step, sends no publish request and names the draft left behind', async (t) => {
  const cwd = await folderWithFiles(t);
  const base = acceptingHandler();
  const { verified, calls, context, lines } = setup({
    config: { assets: ['a.txt', 'b.txt'] },
    context: { cwd },
    handler: (call) => {
      if (call.path.endsWith('/assets')) throw new GiteaApiError('upload failed', { method: 'POST', path: call.path, status: 500 });
      return base(call);
    },
  });
  await assert.rejects(publish(verified, context), (/** @type {GiteaApiError} */ error) => error instanceof GiteaApiError && error.status === 500);
  assert.deepEqual(summary(calls), [`POST ${RELEASES}`, `POST ${RELEASES}/7/assets`]);
  assert.ok(lines.some((line) => line.slice(1).some((value) => String(value).includes(RELEASE_URL))), 'the draft address is logged');
});

test('a file that cannot be read once the draft exists stops the step and names the draft left behind', async (t) => {
  const cwd = await folderWithFiles(t);
  const base = acceptingHandler();
  const { verified, calls, context, lines } = setup({
    config: { assets: ['a.txt'] },
    context: { cwd },
    handler: (call) => {
      // The file vanishes after it was checked and before it is read.
      if (call.method === 'POST' && call.path === RELEASES) rmSync(join(cwd, 'a.txt'));
      return base(call);
    },
  });
  await assert.rejects(publish(verified, context), /ENOENT/);
  assert.deepEqual(summary(calls), [`POST ${RELEASES}`]);
  assert.ok(lines.some((line) => line.slice(1).some((value) => String(value).includes(RELEASE_URL))), 'the draft address is logged');
});

test('a failed final publish request leaves the uploaded draft and names it', async (t) => {
  const cwd = await folderWithFiles(t);
  const base = acceptingHandler();
  const { verified, calls, context, lines } = setup({
    config: { assets: ['a.txt'] },
    context: { cwd },
    handler: (call) => {
      if (call.method === 'PATCH') throw new GiteaApiError('server error', { method: 'PATCH', path: call.path, status: 500 });
      return base(call);
    },
  });
  await assert.rejects(publish(verified, context), (/** @type {GiteaApiError} */ error) => error.status === 500);
  assert.equal(calls.length, 3);
  assert.ok(lines.some((line) => line.slice(1).some((value) => String(value).includes(RELEASE_URL))), 'the draft address is logged');
});

test('everything that can fail without the server is checked before the draft is created', async (t) => {
  const cwd = await folderWithFiles(t);
  const badName = setup({ config: { assets: [{ path: 'a.txt', name: '<%= nothing.here %>' }] }, context: { cwd } });
  await assert.rejects(publish(badName.verified, badName.context), /nothing/);
  assert.equal(badName.calls.length, 0);

  const badBody = setup({ config: { assets: ['a.txt'], releaseBodyTemplate: '<%= nothing.here %>' }, context: { cwd } });
  await assert.rejects(publish(badBody.verified, badBody.context), /nothing/);
  assert.equal(badBody.calls.length, 0);
});

// --- bad answers --------------------------------------------------------------

test('a release answer without an address or an id is an error that names the missing field', async () => {
  const noUrl = setup({ handler: () => ({ id: 7 }) });
  await assert.rejects(publish(noUrl.verified, noUrl.context), /html_url/);
  const noId = setup({ handler: () => ({ html_url: RELEASE_URL }) });
  await assert.rejects(publish(noId.verified, noId.context), /\bid\b/);
});

test('a server error on the first request propagates unchanged', async () => {
  const error = new GiteaApiError('conflict', { method: 'POST', path: RELEASES, status: 409 });
  const { verified, context } = setup({
    handler: () => {
      throw error;
    },
  });
  await assert.rejects(publish(verified, context), (caught) => caught === error);
});
