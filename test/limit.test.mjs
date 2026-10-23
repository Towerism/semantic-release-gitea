import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, limitClient } from '../lib/limit.js';
import { routedClient } from './support/routed-client.mjs';

test('a limiter of 2 never runs more than 2 tasks at once and runs them all', async () => {
  const run = createLimiter(2);
  let active = 0;
  let highest = 0;
  const done = await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      run(async () => {
        active += 1;
        highest = Math.max(highest, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return n;
      }),
    ),
  );
  assert.deepEqual(done, [1, 2, 3, 4, 5]);
  assert.equal(highest, 2);
});

test('a task that throws gives its error to its caller and frees its place', async () => {
  const run = createLimiter(1);
  const failing = run(async () => {
    throw new Error('boom');
  });
  const after = run(async () => 'ok');
  await assert.rejects(failing, /boom/);
  assert.equal(await after, 'ok');
});

test('a task that throws before it returns a promise frees its place and rejects its caller', async () => {
  const run = createLimiter(1);
  const failing = run(
    /** @type {any} */ (
      () => {
        throw new Error('sync boom');
      }
    ),
  );
  const after = run(async () => 'ok');
  await assert.rejects(failing, /sync boom/);
  assert.equal(await after, 'ok');
});

test('limitClient puts both request and paginate behind the same limit', async () => {
  const { client, peak, calls } = routedClient(() => []);
  const limited = limitClient(client, createLimiter(3));
  await Promise.all(Array.from({ length: 10 }, (_, n) => (n % 2 ? limited.request('GET', `/a${n}`) : limited.paginate(`/b${n}`))));
  assert.equal(calls.length, 10);
  assert.equal(peak(), 3);
});
