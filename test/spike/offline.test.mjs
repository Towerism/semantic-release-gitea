import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIssueReferences, checkRepositoryUrls } from '../../scripts/offline-parse-spike.mjs';

const byInput = (list, input) => list.find((entry) => entry.input === input);

test('check 11: parses the three standard repository URL forms to owner and repo', () => {
  const out = checkRepositoryUrls();
  for (const input of [
    'https://gitea.example/owner/repo.git',
    'git@gitea.example:owner/repo.git',
    'ssh://git@gitea.example:2222/owner/repo.git',
  ]) {
    assert.deepEqual(byInput(out, input).parsed, { owner: 'owner', repo: 'repo' }, input);
    assert.equal(byInput(out, input).correct, true, input);
  }
});

test('check 11: records that a sub-path install is parsed wrongly by the GitHub rules', () => {
  const entry = byInput(checkRepositoryUrls(), 'https://gitea.example/gitea/owner/repo.git');
  assert.equal(entry.correct, false);
  assert.deepEqual(entry.expected, { owner: 'owner', repo: 'repo' });
});

test('check 8: records what issue-parser finds for each Gitea reference form', () => {
  const out = checkIssueReferences();
  const inputs = out.map((entry) => entry.input);
  for (const wanted of [
    'Closes #12',
    'Closes owner/repo#12',
    'Closes https://gitea.example/owner/repo/issues/12',
    'Closes https://gitea.example/owner/repo/pulls/12',
    'See https://gitea.example/owner/repo/pulls/12',
    'Merge pull request #7 from owner/branch',
  ]) {
    assert.ok(inputs.includes(wanted), wanted);
  }
  assert.equal(byInput(out, 'Closes #12').parsed.actions.close[0].issue, '12');
});

test('uses only the placeholder host in its inputs', () => {
  const text = JSON.stringify([checkIssueReferences(), checkRepositoryUrls()]);
  assert.ok(!text.includes('martinfracker'));
});
