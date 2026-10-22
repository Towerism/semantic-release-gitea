// Runs the Gitea API checks from issue #3. Needs GITEA_E2E_URL and
// GITEA_E2E_TOKEN in the environment. Prints scrubbed JSON results.
import { run } from './lib/run.mjs';

const { exitCode } = await run({ env: process.env });
process.exitCode = exitCode;
