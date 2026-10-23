import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const e2eFile = fileURLToPath(new URL('./e2e.test.mjs', import.meta.url));

/**
 * Runs the end-to-end test file in a child process. The environment holds PATH and the
 * given variables only, so the owner's real GITEA_E2E_* values and the NODE_TEST_CONTEXT
 * variable of this outer test run are not inherited.
 *
 * @param {Record<string, string>} env
 */
function runE2e(env) {
  const result = spawnSync(process.execPath, ['--test', e2eFile], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test('with E2E_REQUIRED=true and no token, the end-to-end test fails and names the token variable', () => {
  const { status, output } = runE2e({ E2E_REQUIRED: 'true', GITEA_E2E_URL: 'https://gitea.invalid', GITEA_E2E_TOKEN: '' });
  assert.notEqual(status, 0);
  assert.match(output, /GITEA_E2E_TOKEN/);
});

test('with E2E_REQUIRED=true and no URL, the end-to-end test fails and names the URL variable', () => {
  const { status, output } = runE2e({ E2E_REQUIRED: 'true', GITEA_E2E_TOKEN: 'unused-token' });
  assert.notEqual(status, 0);
  assert.match(output, /GITEA_E2E_URL/);
});

test('without E2E_REQUIRED and with both variables empty, both end-to-end tests are skipped and the file passes', () => {
  const { status, output } = runE2e({ GITEA_E2E_URL: '', GITEA_E2E_TOKEN: '' });
  assert.equal(status, 0);
  assert.match(output, /skipped 2/);
});
