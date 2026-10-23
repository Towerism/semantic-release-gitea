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

test('README says which steps are built and that success and fail are not implemented', async () => {
  const readme = await read('README.md');
  assert.match(readme, /not yet functional/i);
  assert.match(readme, /`verifyConditions`, `publish` and `addChannel` are built/);
  for (const step of ['success', 'fail']) {
    assert.match(readme, new RegExp(`\`${step}\``), `README should name the ${step} step`);
  }
  assert.match(readme, /not implemented/i);
});

test('README explains what publish and addChannel do with the release options and assets', async () => {
  const readme = await read('README.md');
  const section = readme.slice(readme.search(/^#+ What `publish` and `addChannel` do$/m));
  assert.ok(section.length < readme.length, 'expected a section on publish and addChannel');
  for (const text of ['Gitea release', 'draftRelease', 'releaseNameTemplate', 'releaseBodyTemplate', 'assets', 'attachment']) {
    assert.ok(section.includes(text), `the section should mention ${text}`);
  }
  assert.match(section, /label[\s\S]*ignored|ignored[\s\S]*label/i, 'it should say an asset label is ignored');
  assert.match(section, /draft/i);
});

test('the architecture document lists GET /version for verifyConditions and answers open question 7', async () => {
  const architecture = await read('docs/architecture.md');
  const row = architecture.split('\n').find((line) => line.startsWith('| `verifyConditions`'));
  assert.ok(row, 'expected a verifyConditions row in the steps table');
  assert.match(row, /GET \/version/);
  assert.match(architecture, /^7\. (Answered|Settled)/m);
});

test('ADR-0006 has an amendment that moves the end-to-end test into CI, and no longer says CI holds no token', async () => {
  const adr = await read('docs/adr/0006-test-strategy.md');
  assert.match(adr, /^## Amendment, 2026-10-22$/m);
  const amendment = adr.slice(adr.search(/^## Amendment/m));
  for (const text of ['.github/workflows/e2e.yml', 'workflow_dispatch', 'pushes to `main`', 'GitHub-hosted', 'E2E_REQUIRED', 'secret store']) {
    assert.ok(amendment.includes(text), `the amendment should mention ${text}`);
  }
  assert.match(amendment, /pull request/i);
  assert.match(amendment, /write access/i);
  assert.ok(amendment.includes('workflow_dispatch plus a push to main'), "the amendment should quote the owner's decision");
  assert.doesNotMatch(adr, /never holds a token/i);
  assert.doesNotMatch(adr, /on a self-hosted runner\./);
  const decision = adr.slice(adr.indexOf('## Decision'), adr.indexOf('## Consequences'));
  assert.match(decision, /E2E_REQUIRED/);
});

test('README says how to run the end-to-end test and lists the variable, the secret and the workflow in the maintainer notes', async () => {
  const readme = await read('README.md');
  const development = readme.slice(readme.search(/^## Development$/m), readme.search(/^## Maintainer notes$/m));
  for (const text of ['GITEA_E2E_URL', 'GITEA_E2E_TOKEN', 'e2e.yml', 'workflow_dispatch']) {
    assert.ok(development.includes(text), `the Development section should mention ${text}`);
  }
  const notes = readme.slice(readme.search(/^## Maintainer notes$/m));
  assert.match(notes, /^6\. .*GITEA_E2E_URL/m);
  assert.match(notes, /^7\. .*GITEA_E2E_TOKEN/m);
  assert.match(notes, /^8\. .*e2e\.yml/m);
});
