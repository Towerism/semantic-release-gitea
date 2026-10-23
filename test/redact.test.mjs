import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../lib/redact.js';

test('redact replaces every occurrence of each secret with ***', () => {
  assert.equal(redact('a s3cret b s3cret', ['s3cret']), 'a *** b ***');
});

test('redact ignores empty and missing secrets', () => {
  assert.equal(redact('plain text', ['', undefined]), 'plain text');
});

test('redact hides the username and password in a URL', () => {
  assert.equal(
    redact('use http://user:pw@proxy.example:3128 or https://tok@host/x', []),
    'use http://***@proxy.example:3128 or https://***@host/x',
  );
});

test('redact leaves a URL without credentials alone', () => {
  assert.equal(redact('https://git.example/a@b', []), 'https://git.example/a@b');
});
