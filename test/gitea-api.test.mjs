import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from './support/gitea-api.mjs';
import { serve } from './support/server.mjs';

const TOKEN = 'tok-secret-1234567890';

test('the helper returns the status and the parsed JSON body', async () => {
  const server = await serve([{ source: 'test', giteaVersion: null, status: 200, body: { login: 'testing' } }]);
  try {
    const api = createApi({ root: server.url, token: TOKEN });
    assert.deepEqual(await api('GET', '/user'), { status: 200, body: { login: 'testing' } });
    assert.equal(server.requests[0].url, '/api/v1/user');
    assert.equal(server.requests[0].headers.authorization, `token ${TOKEN}`);
  } finally {
    await server.close();
  }
});

test('the helper gives up on a server that never answers, after the timeout it was given', async () => {
  const server = await serve([() => {}]);
  try {
    const api = createApi({ root: server.url, token: TOKEN, timeoutMs: 50 });
    await assert.rejects(api('GET', '/user'), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^GET \/user timed out after 50 ms$/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test('a response that is not JSON fails with the method, path and status, and shows neither the body nor the token', async () => {
  const marker = 'MARKER-body-text';
  const server = await serve([{ source: 'test', giteaVersion: null, status: 502, body: `<html>${marker} ${TOKEN}</html>` }]);
  try {
    const api = createApi({ root: server.url, token: TOKEN });
    await assert.rejects(api('GET', '/user'), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'GET /user returned status 502 with a body that is not JSON');
      assert.ok(!error.message.includes(marker) && !error.message.includes(TOKEN));
      assert.ok(!String(error.cause ?? '').includes(marker), 'the underlying parse error must not be attached');
      return true;
    });
  } finally {
    await server.close();
  }
});

test('an empty response body comes back as null', async () => {
  const server = await serve([{ source: 'test', giteaVersion: null, status: 204 }]);
  try {
    const api = createApi({ root: server.url, token: TOKEN });
    assert.deepEqual(await api('DELETE', '/repos/testing/x'), { status: 204, body: null });
  } finally {
    await server.close();
  }
});
