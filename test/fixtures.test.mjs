import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('./fixtures/', import.meta.url);
const files = readdirSync(DIR).filter((name) => name.endsWith('.json'));

test('there are fixtures to check', () => {
  assert.ok(files.length >= 10);
});

for (const name of files) {
  const text = readFileSync(new URL(name, DIR), 'utf8');
  const fixture = JSON.parse(text);

  test(`${name} says where it came from, and a synthetic one has no Gitea version`, () => {
    assert.ok(['captured', 'verification-record', 'synthetic'].includes(fixture.source), `unknown source ${fixture.source}`);
    assert.equal(typeof fixture.status, 'number');
    if (fixture.source === 'synthetic') assert.equal(fixture.giteaVersion, null);
    else assert.match(fixture.giteaVersion, /^\d+\.\d+\.\d+$/);
    if (fixture.source === 'captured') assert.match(fixture.capturedAt, /^\d{4}-\d{2}-\d{2}/);
  });

  test(`${name} holds no real hostname, email address, avatar URL or user ID`, () => {
    const hosts = [...text.matchAll(/https?:\/\/([^/"\s:{]+)/g)].map((m) => m[1]);
    for (const host of hosts) assert.ok(['localhost', 'gitea.example'].includes(host), `unexpected host ${host}`);
    assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.-]+/, 'no email address');
    assert.doesNotMatch(text, /avatar/i, 'no avatar URL');
    assert.doesNotMatch(text, /"(user_)?id"\s*:\s*\d{3,}/, 'no user ID');
  });
}
