import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureLabels } from '../lib/labels.js';
import { LABEL_COLOR } from '../lib/definitions/constants.js';
import { apiError, lines, routedClient } from './support/routed-client.mjs';

const LABELS = '/repos/o/r/labels';

/** @param {Array<{ id: number, name: string }>} existing */
function server(existing) {
  return routedClient(({ method, path, options }) => {
    if (method === 'GET' && path === LABELS) return existing;
    if (method === 'POST' && path === LABELS) {
      const label = { id: 100 + existing.length, name: options.json.name };
      existing.push(label);
      return label;
    }
    return assert.fail(`unexpected ${method} ${path}`);
  });
}

test('names that exist resolve to their ids, in the order asked, with no create call', async () => {
  const { client, calls } = server([
    { id: 4, name: 'released' },
    { id: 9, name: 'ci' },
  ]);
  assert.deepEqual(await ensureLabels(client, 'o', 'r', ['ci', 'released']), [9, 4]);
  assert.deepEqual(lines(calls), [`GET ${LABELS}`]);
});

test('a missing label is created once with the plugin colour and its new id is returned', async () => {
  const { client, calls } = server([{ id: 4, name: 'released' }]);
  const ids = await ensureLabels(client, 'o', 'r', ['released', 'released on @next', 'released on @next']);
  assert.deepEqual(ids, [4, 101, 101]);
  const created = calls.filter(({ method }) => method === 'POST');
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].options.json, { name: 'released on @next', color: LABEL_COLOR });
});

test('names are compared exactly, so a different case is a different label', async () => {
  const { client, calls } = server([{ id: 4, name: 'Released' }]);
  const ids = await ensureLabels(client, 'o', 'r', ['released']);
  assert.deepEqual(ids, [101]);
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
});

test('no names means no requests', async () => {
  const { client, calls } = server([]);
  assert.deepEqual(await ensureLabels(client, 'o', 'r', []), []);
  assert.equal(calls.length, 0);
});

test('the owner and repository are escaped in the path', async () => {
  const { client, calls } = routedClient(() => [{ id: 1, name: 'x' }]);
  await ensureLabels(client, 'a b', 'c/d', ['x']);
  assert.equal(calls[0].path, '/repos/a%20b/c%2Fd/labels');
});

test('a create that fails with a 4xx lists the labels again and uses the one another process made', async () => {
  let listed = 0;
  const { client, calls } = routedClient(({ method }) => {
    if (method === 'GET') {
      listed += 1;
      return listed === 1 ? [] : [{ id: 77, name: 'released' }];
    }
    throw apiError(422, 'name already exists');
  });
  assert.deepEqual(await ensureLabels(client, 'o', 'r', ['released']), [77]);
  assert.equal(calls.filter(({ method }) => method === 'GET').length, 2);
});

test('a 4xx on create with the name still missing after the second list throws the original error', async () => {
  const original = apiError(403, 'no permission to create labels');
  const { client } = routedClient(({ method }) => {
    if (method === 'GET') return [];
    throw original;
  });
  await assert.rejects(ensureLabels(client, 'o', 'r', ['released']), (error) => error === original);
});

test('a server error on create is thrown at once without listing again', async () => {
  const { client, calls } = routedClient(({ method }) => {
    if (method === 'GET') return [];
    throw apiError(500);
  });
  await assert.rejects(ensureLabels(client, 'o', 'r', ['released']), /status 500/);
  assert.equal(calls.filter(({ method }) => method === 'GET').length, 1);
});

test('a failure to list the labels is thrown', async () => {
  const { client } = routedClient(() => {
    throw apiError(500);
  });
  await assert.rejects(ensureLabels(client, 'o', 'r', ['released']), /status 500/);
});
