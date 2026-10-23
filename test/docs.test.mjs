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

test('README documents every option, the environment variables, the minimum server version and the Actions token mapping', async () => {
  const readme = await read('README.md');
  const declaration = await read('index.d.ts');
  const start = declaration.indexOf('interface PluginConfig');
  const body = declaration.slice(start, declaration.indexOf('\n}', start));
  const options = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(options.length >= 17, `expected to find the options in index.d.ts, found ${options.length}`);
  for (const option of options) assert.ok(readme.includes(`\`${option}\``), `README should document the ${option} option`);
  for (const text of ['GITEA_TOKEN', 'GITEA_URL', 'GITEA_PREFIX', '28.2.0', '${{ gitea.token }}', 'RELEASE_TOKEN']) {
    assert.ok(readme.includes(text), `README should mention ${text}`);
  }
});

test('README says which options fail verification, and warns about cleartext http and the proxy package', async () => {
  const readme = await read('README.md');
  assert.match(readme, /discussionCategoryName[\s\S]*EUNSUPPORTEDOPTION|EUNSUPPORTEDOPTION[\s\S]*discussionCategoryName/);
  assert.match(readme, /cleartext/i);
  assert.match(readme, /`undici`[\s\S]*EMISSINGPROXYPACKAGE|EMISSINGPROXYPACKAGE[\s\S]*`undici`/);
});

test('README still says publish, addChannel, success and fail are not implemented', async () => {
  const readme = await read('README.md');
  assert.match(readme, /not yet functional/i);
  for (const step of ['publish', 'addChannel', 'success', 'fail']) {
    assert.match(readme, new RegExp(`\`${step}\``), `README should name the ${step} step`);
  }
  assert.match(readme, /not implemented/i);
});

test('the architecture document lists GET /version for verifyConditions and answers open question 7', async () => {
  const architecture = await read('docs/architecture.md');
  const row = architecture.split('\n').find((line) => line.startsWith('| `verifyConditions`'));
  assert.ok(row, 'expected a verifyConditions row in the steps table');
  assert.match(row, /GET \/version/);
  assert.match(architecture, /^7\. (Answered|Settled)/m);
});
