import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepoUrl } from '../lib/repo-url.js';

const OWNER_REPO = { owner: 'owner', repo: 'repo' };

for (const url of [
  'https://gitea.example/owner/repo.git',
  'https://gitea.example/owner/repo',
  'https://gitea.example/owner/repo/',
  'git@gitea.example:owner/repo.git',
  'git@gitea.example:owner/repo',
  'ssh://git@gitea.example:2222/owner/repo.git',
  'http://localhost:3000/owner/repo.git',
]) {
  test(`${url} gives the owner and the repository`, () => {
    assert.deepEqual(parseRepoUrl(url), OWNER_REPO);
  });
}

test('a server under a sub-path gives the last two segments when no server URL is set', () => {
  assert.deepEqual(parseRepoUrl('https://gitea.example/gitea/owner/repo.git'), OWNER_REPO);
  assert.deepEqual(parseRepoUrl('git@gitea.example:gitea/owner/repo.git'), OWNER_REPO);
});

test('with a server URL, an http URL must have exactly the server URL path before the owner', () => {
  assert.deepEqual(parseRepoUrl('https://gitea.example/gitea/owner/repo.git', 'https://gitea.example/gitea'), OWNER_REPO);
  assert.deepEqual(parseRepoUrl('https://gitea.example/gitea/owner/repo.git', 'https://gitea.example/gitea/'), OWNER_REPO);
  assert.deepEqual(parseRepoUrl('https://gitea.example/owner/repo.git', 'https://gitea.example'), OWNER_REPO);
  assert.equal(parseRepoUrl('https://gitea.example/other/owner/repo.git', 'https://gitea.example/gitea'), null);
  assert.equal(parseRepoUrl('https://gitea.example/owner/repo.git', 'https://gitea.example/gitea'), null);
  assert.equal(parseRepoUrl('https://gitea.example/gitea/extra/owner/repo.git', 'https://gitea.example'), null);
});

test('an SSH remote without the sub-path is accepted when the server is under a sub-path', () => {
  assert.deepEqual(parseRepoUrl('git@gitea.example:owner/repo.git', 'https://gitea.example/gitea'), OWNER_REPO);
  assert.deepEqual(parseRepoUrl('ssh://git@gitea.example:2222/owner/repo.git', 'https://gitea.example/gitea'), OWNER_REPO);
});

test('a server URL that cannot be read does not reject the repository URL', () => {
  assert.deepEqual(parseRepoUrl('https://gitea.example/owner/repo.git', 'not a url'), OWNER_REPO);
});

for (const bad of ['', '   ', 'https://gitea.example/repo', 'https://gitea.example/', 'git@gitea.example:repo.git', 'owner/repo', '/srv/git/repo.git', 'https://gitea.example/owner/.git']) {
  test(`"${bad}" is not a repository URL`, () => {
    assert.equal(parseRepoUrl(bad), null);
  });
}

test('a value that is not a string is not a repository URL', () => {
  assert.equal(parseRepoUrl(/** @type {any} */ (undefined)), null);
  assert.equal(parseRepoUrl(/** @type {any} */ (42)), null);
});
