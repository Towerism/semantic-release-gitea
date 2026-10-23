import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(root, 'node_modules', '.bin', 'tsc');

/**
 * @param {string[]} args
 */
function runTsc(args) {
  return spawnSync(tsc, args, { cwd: root, encoding: 'utf8' });
}

test('the project type-checks cleanly with the root tsconfig', () => {
  const result = runTsc(['--noEmit']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('the same settings fail on a type error and pass once it is fixed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tsc-check-'));
  try {
    const file = join(dir, 'sample.js');
    const config = join(dir, 'tsconfig.json');
    await writeFile(
      config,
      JSON.stringify({
        extends: join(root, 'tsconfig.json'),
        compilerOptions: { types: [] },
        include: [file],
        exclude: [],
      }),
    );

    await writeFile(file, '/** @type {number} */\nconst n = "not a number";\nexport default n;\n');
    const bad = runTsc(['--noEmit', '-p', config]);
    assert.notEqual(bad.status, 0, 'a string assigned to a number must fail the check');

    await writeFile(file, '/** @type {number} */\nconst n = 1;\nexport default n;\n');
    const good = runTsc(['--noEmit', '-p', config]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
