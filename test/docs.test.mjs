import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * @param {string} path
 */
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('README names the package, shows a .releaserc example and says all five steps are built', async () => {
  const readme = await read('README.md');
  assert.match(readme, /semantic-release-gitea/);
  const jsonBlocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(jsonBlocks.some((block) => block.includes('"semantic-release-gitea"')), 'expected a .releaserc example');
  assert.match(readme, /all five steps are built/i);
  assert.doesNotMatch(readme, /not yet functional|not implemented/i);
});

test('README maintainer notes cover the first publish, the missing tag and the release switch', async () => {
  const readme = await read('README.md');
  assert.match(readme, /^#+ Maintainer notes$/m);
  const notes = readme.slice(readme.search(/^#+ Maintainer notes$/m));
  assert.match(notes, /0\.0\.0/);
  assert.match(notes, /no `v0\.0\.0` tag/i);
  assert.match(notes, /RELEASES_ENABLED/);
  assert.match(notes, /trusted publishing/i);
  assert.match(notes, /first automatic release is `1\.0\.0`/i);
  assert.match(notes, /delete the tag/i);
  for (const stale of ['stay off', 'not published', 'until you set', 'v1 is ready']) {
    assert.ok(!readme.toLowerCase().includes(stale), `README should not contain "${stale}"`);
  }
});

test('ADR-0007 records the owner decision, the placeholder version and the release switch', async () => {
  const adr = await read('docs/adr/0007-publish-to-npm.md');
  assert.ok(adr.includes('releases do run on every push. just not until v1 is ready. v0.0.0 will not be tagged.'));
  assert.match(adr, /RELEASES_ENABLED/);
  assert.match(adr, /0\.0\.0/);
  assert.match(adr, /1\.0\.0/);
});

test('the architecture document and the release workflow say releases are on', async () => {
  for (const file of ['docs/architecture.md', '.github/workflows/release.yml']) {
    const text = await read(file);
    assert.match(text, /RELEASES_ENABLED/, `${file} should name the release switch`);
    assert.match(text, /releases are on/i, `${file} should say releases are on`);
    assert.doesNotMatch(text, /off until v1/i, `${file} should not say releases are off`);
  }
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

test('README explains what success does with every option it uses, the template variables and the pull request rules', async () => {
  const readme = await read('README.md');
  const section = readme.slice(readme.search(/^#+ What `success` does$/m), readme.search(/^#+ What `fail` does$/m));
  assert.ok(section.length > 0 && section.length < readme.length, 'expected a section on success');
  for (const text of ['successComment', 'successCommentCondition', 'releasedLabels', 'addReleases', 'issue.pull_request', '(#N)', 'issue-parser', '/pulls/', 'failure issue', 'releaseBodyTemplate', 'five requests']) {
    assert.ok(section.includes(text), `the success section should mention ${text}`);
  }
  assert.match(section, /<% return/);
});

test('README explains what fail does, that it skips the checks of verifyConditions, and what it falls back to', async () => {
  const readme = await read('README.md');
  const section = readme.slice(readme.search(/^#+ What `fail` does$/m), readme.search(/^#+ Differences from the GitHub plugin$/m));
  assert.ok(section.length > 0 && section.length < readme.length, 'expected a section on fail');
  for (const text of ['failTitle', 'failComment', 'failCommentCondition', 'labels', 'assignees', 'semantic-release:gitea', 'ENOGITEATOKEN', 'ADR-0008', 'default']) {
    assert.ok(section.includes(text), `the fail section should mention ${text}`);
  }
  assert.match(section, /does not run the checks of `verifyConditions`/);
});

test('README lists the differences from the GitHub plugin', async () => {
  const readme = await read('README.md');
  const section = readme.slice(readme.search(/^#+ Differences from the GitHub plugin$/m), readme.search(/^## Environment variables$/m));
  assert.ok(section.length > 0 && section.length < readme.length, 'expected the differences section');
  for (const text of ['discussionCategoryName', 'make_latest', '/pulls/', '(#N)', 'releaseBodyTemplate', 'verifyConditions', 'issue.pull_request']) {
    assert.ok(section.includes(text), `the differences should mention ${text}`);
  }
});

test('ADR-0008 records the owner decision that fail skips the full verification', async () => {
  const adr = await read('docs/adr/0008-fail-without-full-verification.md');
  assert.match(adr, /^# ADR-0008:/m);
  assert.ok(adr.includes('("approve ADR-0008")'), 'the status quotes the owner');
  assert.match(adr, /^\*\*Status:\*\* accepted, 2026-10-22, by Towerism/m);
  for (const heading of ['Context', 'Options', 'Decision', 'Consequences', 'Revisit when']) {
    assert.match(adr, new RegExp(`^## ${heading}$`, 'm'), `ADR-0008 should have a ${heading} section`);
  }
  for (const option of ['Verify first', 'lighter check', 'No check']) {
    assert.ok(adr.toLowerCase().includes(option.toLowerCase()), `the options should include ${option}`);
  }
});

test('the architecture document lists the new modules, the success and fail endpoints, the differences and ADR-0008', async () => {
  const architecture = await read('docs/architecture.md');
  for (const module of ['connect.js', 'failure-issues.js', 'limit.js']) assert.ok(architecture.includes(module), `expected ${module} in the module list`);
  const successRow = architecture.split('\n').find((line) => line.startsWith('| `success`'));
  const failRow = architecture.split('\n').find((line) => line.startsWith('| `fail`'));
  assert.match(String(successRow), /PATCH …\/issues\/\{n\}/);
  assert.match(String(successRow), /PATCH …\/releases/);
  assert.match(String(failRow), /GET \/repos\/\{owner\}\/\{repo\}/);
  assert.match(architecture, /ADR-0008/);
  assert.match(architecture, /every step but `fail`/);
  const differences = architecture.slice(architecture.search(/^## Differences from the GitHub plugin$/m), architecture.search(/^## Trade-offs and limits$/m));
  for (const text of ['`fail`', '`(#N)`', '`releaseBodyTemplate`']) assert.ok(differences.includes(text), `the differences table should mention ${text}`);
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
