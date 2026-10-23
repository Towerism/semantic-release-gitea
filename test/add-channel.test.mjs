import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addChannel } from '../lib/add-channel.js';
import { GiteaApiError } from '../lib/client.js';
import { setup, RELEASE_URL } from './support/release-helpers.mjs';

const RELEASES = '/repos/o/r/releases';

/** @param {{ method: string, path: string }[]} calls */
const summary = (calls) => calls.map(({ method, path }) => `${method} ${path}`);

const channelContext = { branch: { name: 'next', type: 'prerelease', main: false, prerelease: 'next', channel: 'next' } };

test('an existing release is updated with the name and the pre-release flag, and nothing else', async () => {
  const { verified, calls, context } = setup({ context: channelContext });
  const result = await addChannel(verified, context);
  assert.deepEqual(summary(calls), [`GET ${RELEASES}/tags/v1.2.0`, `PATCH ${RELEASES}/7`]);
  assert.deepEqual(calls[1].options.json, { tag_name: 'v1.2.0', name: '1.2.0', prerelease: true });
  assert.deepEqual(result, { url: RELEASE_URL, name: 'Gitea release' });
});

test('the update clears the pre-release flag when the release moved to the main channel', async () => {
  const { verified, calls, context } = setup();
  await addChannel(verified, context);
  assert.equal(calls[1].options.json.prerelease, false);
});

test('a missing release is created with the notes, and the answer is returned', async () => {
  const { verified, calls, context, lines } = setup({
    context: channelContext,
    handler: ({ method }) => {
      if (method === 'GET') throw new GiteaApiError('not found', { method: 'GET', path: `${RELEASES}/tags/v1.2.0`, status: 404 });
      return { id: 9, html_url: RELEASE_URL };
    },
  });
  const result = await addChannel(verified, context);
  assert.deepEqual(summary(calls), [`GET ${RELEASES}/tags/v1.2.0`, `POST ${RELEASES}`]);
  assert.deepEqual(calls[1].options.json, { tag_name: 'v1.2.0', name: '1.2.0', prerelease: true, body: 'N' });
  assert.deepEqual(result, { url: RELEASE_URL, name: 'Gitea release' });
  assert.ok(lines.some(([level, message]) => level === 'log' && /There is no release for tag/.test(String(message))));
});

test('a created release gets an empty body when the release has no notes', async () => {
  const { verified, calls, context } = setup({
    context: { nextRelease: { version: '1.2.0', gitTag: 'v1.2.0', name: '1.2.0' } },
    handler: ({ method }) => {
      if (method === 'GET') throw new GiteaApiError('not found', { method: 'GET', path: '/x', status: 404 });
      return { id: 9, html_url: RELEASE_URL };
    },
  });
  await addChannel(verified, context);
  assert.equal(calls[1].options.json.body, '');
});

test('a failed lookup that is not a 404 propagates and nothing is created', async () => {
  const error = new GiteaApiError('unauthorized', { method: 'GET', path: '/x', status: 401 });
  const { verified, calls, context } = setup({
    handler: () => {
      throw error;
    },
  });
  await assert.rejects(addChannel(verified, context), (caught) => caught === error);
  assert.equal(calls.length, 1);
});

test('an answer without an address is an error that names the field', async () => {
  const { verified, context } = setup({ handler: () => ({ id: 7 }) });
  await assert.rejects(addChannel(verified, context), /html_url/);
});
