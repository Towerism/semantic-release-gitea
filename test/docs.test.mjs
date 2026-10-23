import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * @param {string} path
 */
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('README names the package, shows a .releaserc example and says the plugin does not work yet', async () => {
  const readme = await read('README.md');
  assert.match(readme, /semantic-release-gitea/);
  const jsonBlocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(jsonBlocks.some((block) => block.includes('"semantic-release-gitea"')), 'expected a .releaserc example');
  assert.match(readme, /not (yet )?functional|does not work yet/i);
});

test('README maintainer notes cover the first publish, the missing tag and the release switch', async () => {
  const readme = await read('README.md');
  assert.match(readme, /^#+ Maintainer notes$/m);
  const notes = readme.slice(readme.search(/^#+ Maintainer notes$/m));
  assert.match(notes, /0\.0\.0/);
  assert.match(notes, /no `v0\.0\.0` tag/i);
  assert.match(notes, /RELEASES_ENABLED/);
  assert.match(notes, /trusted publishing/i);
});

test('ADR-0007 records the owner decision, the placeholder version and the release switch', async () => {
  const adr = await read('docs/adr/0007-publish-to-npm.md');
  assert.ok(adr.includes('releases do run on every push. just not until v1 is ready. v0.0.0 will not be tagged.'));
  assert.match(adr, /RELEASES_ENABLED/);
  assert.match(adr, /0\.0\.0/);
  assert.match(adr, /1\.0\.0/);
});

test('the architecture document says releases are off until v1', async () => {
  const architecture = await read('docs/architecture.md');
  assert.match(architecture, /RELEASES_ENABLED/);
  assert.match(architecture, /off until v1/i);
});
