import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as plugin from '../index.js';

const LIFECYCLE = ['addChannel', 'fail', 'publish', 'success', 'verifyConditions'];

test('index.js exports exactly the five lifecycle functions', () => {
  assert.deepEqual(Object.keys(plugin).sort(), LIFECYCLE);
});

test('each lifecycle function returns a promise that rejects as not implemented', async () => {
  const functions = /** @type {Record<string, (a: object, b: object) => Promise<unknown>>} */ (
    /** @type {unknown} */ (plugin)
  );
  for (const name of LIFECYCLE) {
    const result = functions[name]({}, {});
    assert.ok(result instanceof Promise, `${name} must be async, not throw synchronously`);
    await assert.rejects(result, /not implemented/i, `${name} should say it is not implemented`);
  }
});

test('index.d.ts declares the same names as index.js exports, and no others', async () => {
  const declaration = await readFile(new URL('../index.d.ts', import.meta.url), 'utf8');
  const declared = [...declaration.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(declared, LIFECYCLE);
  const exportLines = declaration.split('\n').filter((line) => line.startsWith('export'));
  assert.equal(exportLines.length, LIFECYCLE.length, 'index.d.ts must have no other exports');
});
