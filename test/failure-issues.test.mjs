import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFailureIssues } from '../lib/failure-issues.js';
import { FAILURE_MARKER } from '../lib/definitions/constants.js';
import { apiError, routedClient } from './support/routed-client.mjs';

const ISSUES = '/repos/o/r/issues';

/** @param {number} number @param {string | null} body */
const issue = (number, body) => ({ number, body, title: `issue ${number}` });

test('open issues are listed by type and labels, and only those with the marker are kept, lowest number first', async () => {
  const { client, calls } = routedClient(() => [
    issue(9, `text\n\n${FAILURE_MARKER}`),
    issue(3, 'labelled the same but written by a person'),
    issue(4, `older failure\n\n${FAILURE_MARKER}`),
    issue(5, null),
  ]);
  const found = await findFailureIssues(client, 'o', 'r', ['ci']);
  assert.deepEqual(found.map(({ number }) => number), [4, 9]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, ISSUES);
  assert.equal(calls[0].paged, true);
  assert.deepEqual(calls[0].options.query, { state: 'open', type: 'issues', labels: 'ci,semantic-release' });
});

test('the failure label is always asked for, and only once', async () => {
  const { client, calls } = routedClient(() => []);
  await findFailureIssues(client, 'o', 'r', ['semantic-release']);
  await findFailureIssues(client, 'o', 'r', []);
  assert.equal(calls[0].options.query.labels, 'semantic-release');
  assert.equal(calls[1].options.query.labels, 'semantic-release');
});

test('the marker decides, so issues the label filter returned wrongly are dropped', async () => {
  const { client } = routedClient(() => [issue(1, 'unrelated open issue'), issue(2, 'another one')]);
  assert.deepEqual(await findFailureIssues(client, 'o', 'r', ['ci']), []);
});

test('an error from the listing is thrown', async () => {
  const { client } = routedClient(() => {
    throw apiError(500);
  });
  await assert.rejects(findFailureIssues(client, 'o', 'r', []), /status 500/);
});
