import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('the packed tarball holds only the allowed files', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  /** @type {string[]} */
  const paths = pack.files.map((/** @type {{ path: string }} */ file) => file.path);
  const allowed = (/** @type {string} */ path) =>
    ['index.js', 'index.d.ts', 'package.json', 'LICENSE', 'README.md'].includes(path) || path.startsWith('lib/');
  const unexpected = paths.filter((path) => !allowed(path));
  assert.deepEqual(unexpected, [], `unexpected files in the tarball: ${unexpected.join(', ')}`);
  assert.ok(paths.includes('index.js'));
  assert.ok(paths.includes('README.md'));
});
