import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('package is named, public and an ES module entry at index.js', () => {
  assert.equal(pkg.name, 'semantic-release-gitea');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.version, '0.0.0');
  assert.equal(pkg.main, './index.js');
  assert.equal(pkg.exports, './index.js');
  assert.equal(pkg.types, './index.d.ts');
});

test('engines and peer dependency match ADR-0003', () => {
  assert.equal(pkg.engines.node, '^22.14.0 || >= 24.10.0');
  assert.equal(pkg.peerDependencies['semantic-release'], '>=24.1.0');
  assert.deepEqual(Object.keys(pkg.peerDependencies).sort(), ['semantic-release', 'undici']);
});

test('only the source, lib and type declarations are published', () => {
  assert.deepEqual(pkg.files, ['index.js', 'lib/', 'index.d.ts']);
});

test('repository metadata points at the GitHub repository, without provenance set', () => {
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'git+https://github.com/Towerism/semantic-release-gitea.git');
  assert.match(pkg.bugs.url, /github\.com\/Towerism\/semantic-release-gitea\/issues/);
  assert.match(pkg.homepage, /github\.com\/Towerism\/semantic-release-gitea/);
  assert.deepEqual(pkg.publishConfig, { access: 'public' });
});

test('the runtime dependencies are the two error packages, the issue parser, the template library and the glob library, all pinned exactly', () => {
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@semantic-release/error', 'aggregate-error', 'issue-parser', 'lodash-es', 'tinyglobby']);
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    assert.match(String(version), /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version`);
  }
  const allowed = [
    '@semantic-release/commit-analyzer',
    '@semantic-release/github',
    '@semantic-release/npm',
    '@semantic-release/release-notes-generator',
    '@types/lodash-es',
    '@types/node',
    'semantic-release',
    'typescript',
    'yaml',
  ];
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), allowed);
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(String(version), /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version`);
  }
  assert.match(pkg.devDependencies['@types/node'], /^22\./);
});

test('npm test and npm run lint are defined', () => {
  assert.equal(pkg.scripts.test, 'node --test "test/**/*.test.mjs"');
  assert.equal(pkg.scripts.lint, 'tsc --noEmit');
});

test('undici is an optional peer dependency, needed only for a proxy', () => {
  assert.ok(pkg.peerDependencies.undici, 'undici should be listed as a peer dependency');
  assert.deepEqual(pkg.peerDependenciesMeta, { undici: { optional: true } });
});
