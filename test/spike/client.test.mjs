import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createClient } from '../../scripts/lib/client.mjs';

const TOKEN = 'tok_0123456789abcdef0123456789abcdef01234567';

// A stand-in for Gitea: records every request it receives.
async function fakeServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { seen, port, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

test('sends the token to the configured origin and parses JSON', async () => {
  const srv = await fakeServer((req, res) => json(res, 200, { version: '1.2.3' }));
  const client = createClient({ baseUrl: srv.url, token: TOKEN });
  const out = await client.request('GET', '/version');
  await srv.close();
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { version: '1.2.3' });
  assert.equal(srv.seen[0].url, '/api/v1/version');
  assert.equal(srv.seen[0].auth, `token ${TOKEN}`);
});

test('does not follow a redirect and records it, with no token sent elsewhere', async () => {
  const other = await fakeServer((req, res) => json(res, 200, {}));
  const srv = await fakeServer((req, res) => {
    res.writeHead(302, { location: `${other.url}/stolen` });
    res.end();
  });
  const client = createClient({ baseUrl: srv.url, token: TOKEN });
  const out = await client.request('GET', '/user');
  await srv.close();
  await other.close();
  assert.equal(out.status, 302);
  assert.equal(out.redirected, true);
  assert.equal(other.seen.length, 0);
});

test('refuses an absolute URL as a path, so the token cannot be sent elsewhere', async () => {
  const client = createClient({ baseUrl: 'http://127.0.0.1:1', token: TOKEN });
  await assert.rejects(client.request('GET', 'https://elsewhere.invalid/x'), /relative/);
});

test('returns only allowlisted headers', async () => {
  const srv = await fakeServer((req, res) => json(res, 429, {}, { 'retry-after': '5', 'set-cookie': 'a=b' }));
  const client = createClient({ baseUrl: srv.url, token: TOKEN });
  const out = await client.request('GET', '/x');
  await srv.close();
  assert.deepEqual(out.headers, { 'retry-after': '5', 'content-type': 'application/json' });
});

test('turns a network failure into a scrubbed result and does not throw', async () => {
  const client = createClient({ baseUrl: 'http://127.0.0.1:1', token: TOKEN, host: '127.0.0.1' });
  const out = await client.request('GET', '/x');
  assert.equal(out.status, 0);
  assert.ok(!JSON.stringify(out).includes('127.0.0.1'));
});

test('aborts a request when the injected signal fires', async () => {
  const srv = await fakeServer(() => {}); // never answers
  const controller = new AbortController();
  const client = createClient({ baseUrl: srv.url, token: TOKEN, makeSignal: () => controller.signal });
  const pending = client.request('GET', '/slow');
  setImmediate(() => controller.abort());
  const out = await pending;
  srv.close();
  assert.equal(out.status, 0);
  assert.match(out.error.message, /abort/i);
});

test('sends a JSON body with a content-type', async () => {
  let body = '';
  const srv = await fakeServer((req, res) => {
    req.on('data', (c) => (body += c));
    req.on('end', () => json(res, 201, { id: 1 }));
  });
  const client = createClient({ baseUrl: srv.url, token: TOKEN });
  const out = await client.request('POST', '/user/repos', { json: { name: 'x' } });
  await srv.close();
  assert.equal(out.status, 201);
  assert.equal(body, '{"name":"x"}');
});
