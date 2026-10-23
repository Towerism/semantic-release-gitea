import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { prepareAssets } from '../lib/assets.js';
import { recordingLogger } from './support/release-helpers.mjs';

/**
 * Makes a project folder with a known set of files, and removes it afterwards.
 * @param {import('node:test').TestContext} t
 */
async function project(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'sr-gitea-assets-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, 'dist'));
  await mkdir(join(cwd, 'docs'));
  await mkdir(join(cwd, 'empty'));
  for (const file of ['dist/a.tgz', 'dist/b.tgz', 'dist/skip.tgz', 'docs/x.pdf', 'docs/y.pdf', 'notes.txt', 'dist/.hidden']) {
    await writeFile(join(cwd, file), `content of ${file}`);
  }
  const { logger, lines } = recordingLogger();
  const context = /** @type {any} */ ({ cwd, logger, nextRelease: { version: '1.2.0', gitTag: 'v1.2.0' } });
  return { cwd, context, lines };
}

/** @param {Array<{ path: string }>} assets @param {string} cwd */
const relative = (assets, cwd) => assets.map((asset) => asset.path.replace(`${cwd}/`, ''));

/** @param {unknown[]} line */
const mentions = (line, /** @type {string} */ text) => line.slice(1).some((value) => String(value).includes(text));

test('a glob string matches files, and a group with a negated glob leaves one out', async (t) => {
  const { cwd, context } = await project(t);
  const assets = await prepareAssets(context, [['dist/*.tgz', '!dist/skip.tgz']]);
  assert.deepEqual(relative(assets, cwd).sort(), ['dist/a.tgz', 'dist/b.tgz']);
  assert.deepEqual(assets.map((a) => a.name).sort(), ['a.tgz', 'b.tgz']);
});

test('a negated glob that stands alone is skipped instead of matching everything', async (t) => {
  const { context, lines } = await project(t);
  assert.deepEqual(await prepareAssets(context, ['!dist/skip.tgz']), []);
  assert.deepEqual(lines, []);
});

test('an object whose path matches several files gives one asset per file, named by its base name', async (t) => {
  const { cwd, context } = await project(t);
  const assets = await prepareAssets(context, [{ path: 'docs/*.pdf', name: 'ignored-when-many.pdf' }]);
  assert.deepEqual(relative(assets, cwd).sort(), ['docs/x.pdf', 'docs/y.pdf']);
  assert.deepEqual(assets.map((a) => a.name).sort(), ['x.pdf', 'y.pdf']);
});

test('the same file listed twice is returned once, and the object definition wins over the string', async (t) => {
  const { cwd, context } = await project(t);
  const assets = await prepareAssets(context, ['notes.txt', { path: 'notes.txt', name: 'README-notes.txt' }, 'notes.txt']);
  assert.deepEqual(relative(assets, cwd), ['notes.txt']);
  assert.equal(assets[0].name, 'README-notes.txt');
});

test('dot files match, and a directory name matches the files inside it', async (t) => {
  const { cwd, context } = await project(t);
  const assets = await prepareAssets(context, ['dist']);
  assert.deepEqual(relative(assets, cwd).sort(), ['dist/.hidden', 'dist/a.tgz', 'dist/b.tgz', 'dist/skip.tgz']);
});

test('a path that is missing or is not a file is logged as an error and skipped, and the others stay', async (t) => {
  const { cwd, context, lines } = await project(t);
  const assets = await prepareAssets(context, ['missing.bin', 'empty', 'notes.txt']);
  assert.deepEqual(relative(assets, cwd), ['notes.txt']);
  const errors = lines.filter(([level]) => level === 'error');
  assert.equal(errors.length, 2);
  assert.ok(errors.some((line) => mentions(line, 'missing.bin')), 'names the missing path');
  assert.ok(errors.some((line) => mentions(line, 'empty')), 'names the directory');
});

test('the asset name is a template rendered with the release context', async (t) => {
  const { context } = await project(t);
  const [asset] = await prepareAssets(context, [{ path: 'notes.txt', name: 'app-<%= nextRelease.version %>.txt' }]);
  assert.equal(asset.name, 'app-1.2.0.txt');
});

test('a label is ignored with one warning for that asset', async (t) => {
  const { context, lines } = await project(t);
  const assets = await prepareAssets(context, [{ path: 'notes.txt', label: 'Notes' }, 'dist/a.tgz']);
  assert.equal(assets.length, 2);
  const warnings = lines.filter(([level]) => level === 'warn');
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].slice(1).some((value) => /label/i.test(String(value))));
});

test('a name template that throws rejects with that error', async (t) => {
  const { context } = await project(t);
  await assert.rejects(prepareAssets(context, [{ path: 'notes.txt', name: '<%= nothing.here %>' }]), /nothing/);
});

test('file names with spaces and non-ASCII characters are kept as written', async (t) => {
  const { cwd, context } = await project(t);
  await writeFile(join(cwd, 'my file ü.txt'), 'x');
  const [asset] = await prepareAssets(context, ['my file ü.txt']);
  assert.equal(asset.name, 'my file ü.txt');
  assert.equal(basename(asset.path), 'my file ü.txt');
});
