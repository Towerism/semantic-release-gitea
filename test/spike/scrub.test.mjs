import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeScrubber, filterHeaders } from '../../scripts/lib/scrub.mjs';

const TOKEN = 'tok_0123456789abcdef0123456789abcdef01234567';
const HOST = 'gitea.test.invalid';

const user = (overrides = {}) => ({
  id: 7,
  login: 'testing',
  username: 'testing',
  full_name: 'Test User',
  email: 'testing@gitea.test.invalid',
  avatar_url: `https://${HOST}/avatars/abc123`,
  html_url: `https://${HOST}/testing`,
  ...overrides,
});

const scrub = makeScrubber({ token: TOKEN, host: HOST });
const text = (value) => JSON.stringify(scrub(value));

test('removes the token wherever it appears', () => {
  const out = text({
    header: `token ${TOKEN}`,
    error: new Error(`failed with ${TOKEN}`).message,
    url: `https://x.invalid/?access_token=${TOKEN}`,
  });
  assert.ok(!out.includes(TOKEN));
});

test('removes the hostname from URLs, headers and network errors', () => {
  const out = text({
    html_url: `https://${HOST}/o/r`,
    clone_url: `https://${HOST}/o/r.git`,
    location: `https://${HOST}/login`,
    link: `<https://${HOST}/api/v1/x?page=2>; rel="next"`,
    error: `fetch failed: getaddrinfo ENOTFOUND ${HOST}`,
  });
  assert.ok(!out.includes(HOST));
});

test('removes the host of any URL, since the server may report a different public name', () => {
  const out = text({
    clone_url: 'https://git.other.example:8443/testing/r.git',
    ssh_url: 'ssh://git@git.other.example:2222/testing/r.git',
  });
  assert.ok(!out.includes('other.example'));
  assert.ok(out.includes('/testing/r.git'));
});

test('removes emails and avatar URLs', () => {
  const out = text({ owner: user(), commit: { author: { email: 'a.b@example.org' } } });
  assert.ok(!out.includes('@'));
  assert.ok(!out.includes('avatars'));
});

test('removes id, login, username and full_name under every user-bearing key', () => {
  for (const key of ['owner', 'user', 'poster', 'author', 'merged_by', 'assignee']) {
    const out = scrub({ [key]: user() })[key];
    for (const field of ['id', 'login', 'username', 'full_name']) {
      assert.equal(out[field], undefined, `${key}.${field}`);
    }
  }
});

test('removes user fields inside the assignees array', () => {
  const out = scrub({ assignees: [user(), user({ id: 8 })] });
  for (const a of out.assignees) {
    assert.equal(a.id, undefined);
    assert.equal(a.login, undefined);
  }
});

test('removes user_id and uid keys', () => {
  const out = scrub({ user_id: 7, uid: 7, owner_id: 7 });
  assert.equal(out.user_id, undefined);
  assert.equal(out.uid, undefined);
  assert.equal(out.owner_id, undefined);
});

test('keeps release, label, issue, pull request and asset ids', () => {
  const out = scrub({
    release: { id: 11, tag_name: 'v1.0.0', assets: [{ id: 21, name: 'a.zip' }] },
    labels: [{ id: 31, name: 'bug' }],
    issue: { id: 41, number: 3 },
    pull: { id: 51, number: 4, user: user() },
  });
  assert.equal(out.release.id, 11);
  assert.equal(out.release.assets[0].id, 21);
  assert.equal(out.labels[0].id, 31);
  assert.equal(out.issue.id, 41);
  assert.equal(out.pull.id, 51);
  assert.equal(out.pull.user.id, undefined);
});

test('scrubs an Error, including its cause', () => {
  const err = new Error(`boom ${HOST}`, { cause: new Error(`inner ${TOKEN}`) });
  const out = text(scrub(err));
  assert.ok(!out.includes(HOST));
  assert.ok(!out.includes(TOKEN));
});

test('does not mutate its input', () => {
  const input = { owner: user() };
  scrub(input);
  assert.equal(input.owner.id, 7);
});

test('hides the token and host at any depth', () => {
  let node = { leaf: `${TOKEN} ${HOST}` };
  for (let depth = 0; depth < 25; depth++) node = { next: [node], owner: user() };
  const out = text(node);
  assert.ok(!out.includes(TOKEN));
  assert.ok(!out.includes(HOST));
});

test('keeps only allowlisted headers', () => {
  const headers = new Headers({
    'Set-Cookie': 'i_like_gitea=abc',
    Location: `https://${HOST}/x`,
    Link: '<x>; rel="next"',
    'Retry-After': '30',
    'Content-Type': 'application/json',
    'X-RateLimit-Remaining': '9',
  });
  assert.deepEqual(filterHeaders(headers), {
    'retry-after': '30',
    'content-type': 'application/json',
    'x-ratelimit-remaining': '9',
  });
});

test('removes user ID keys but keeps other IDs', () => {
  const out = scrub({
    poster_id: 5,
    original_author_id: 6,
    merger_id: 7,
    creator_id: 8,
    uid: 9,
    milestone_id: 11,
    release_id: 12,
    id: 13,
  });
  assert.deepEqual(out, { milestone_id: 11, release_id: 12, id: 13 });
});
