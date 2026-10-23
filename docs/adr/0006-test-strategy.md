# ADR-0006: Test with fakes by default and a live Gitea on demand

**Status:** accepted, 2026-10-22, by Towerism, the repository owner ("approve architecture and all ADRs").

Tests run in two layers. The default layer needs no network. An opt-in layer runs the real plugin against a Gitea server and a throwaway repository.

## Context

Mocks record what we believe Gitea does. Our personal server, `vcs.martinfrackerjr.com`, is available for testing, but it requires a signed-in token even for read calls, and the repository is public on GitHub. The owner confirmed on 2026-10-22 that a dedicated test user named `testing` exists on the server, with a scoped token.

## Options

| Option | For | Against |
|---|---|---|
| Fakes only | Fast, runs anywhere | Drifts from real Gitea behavior |
| Live server only | True behavior | Slow, needs a token, flaky on network |
| Both, live layer opt-in | Fast default; real check before release | Two suites to keep in step |

## Decision

1. **Unit tests** use `node:test` and a fake client. They cover config resolution, option validation, URL parsing, message templates and each lifecycle function's request sequence.
2. **Contract tests** run the real `client.js` against a local `http` server that replays response fixtures captured from the live server. Fixtures are refreshed by a script, and the Gitea version is recorded in each one. The script scrubs emails, avatar URLs, hostnames and user IDs before a fixture is written, because the repository is public. The e2e cleanup deletes only repositories whose names start with `sr-e2e-` and that the test user owns.
3. **End-to-end tests** run only when `GITEA_E2E_URL` and `GITEA_E2E_TOKEN` are set, except that when `E2E_REQUIRED` is `true` a missing variable fails the test instead of skipping it (the CI workflow sets it, see the amendment). Each run creates a repository named `sr-e2e-<timestamp>` under a test user, runs `semantic-release` for real through `verify`, `publish`, `addChannel`, `success` and `fail`, checks the results through the API, and deletes the repository. The token is a dedicated one with repository and issue scopes, created for this purpose.

Development follows red-green-refactor, test first.

## Consequences

The e2e layer is our protection against Gitea changes. Fixtures need an occasional refresh, which the script makes one command. GitHub Actions runs the unit and contract layers on every pull request. The e2e layer runs from the maintainer's shell and from a separate workflow, as the amendment below describes. The token never enters the repository.

## Amendment, 2026-10-22

The owner set `GITEA_E2E_URL` as a repository Actions variable and `GITEA_E2E_TOKEN` as a repository Actions secret, and chose the triggers: "workflow_dispatch plus a push to main". This replaces the earlier plan that CI would never hold a token and that any CI e2e job would be started by hand on a self-hosted machine.

- **What runs:** `.github/workflows/e2e.yml` runs `node --test test/e2e.test.mjs` on `workflow_dispatch` and on pushes to `main`. It runs on a GitHub-hosted runner, with read-only repository permissions, one run at a time, and a 10-minute limit. The test step alone receives the variable and the secret. The token now sits in GitHub's secret store, which is the change from the original decision.
- **Missing values fail the run:** the workflow sets `E2E_REQUIRED` to `true`, so a renamed or deleted variable or secret fails the job instead of passing with the test skipped.
- **Why not on pull requests:** a pull request from a branch in this repository could change the test to print the secret. Leaving pull requests out stops accidental exposure while reviewing one. It does not stop a person with write access, who can dispatch a changed `e2e.yml` from their own branch and read a repository-level secret. A dependency loaded by the test step can also read the token while that step runs. The repository has one collaborator, the owner, so the risk is accepted. If a second person gets write access, move the secret into a GitHub environment limited to `main`.
- **The release job does not wait for it:** a failed e2e run, for example while the server is down, does not block a release. Revisit when releases are turned on for v1.
- **Leftovers:** a run killed by the timeout or cancelled can leave a repository named `sr-e2e-<milliseconds>` on the server. Nothing in CI removes it. The spike script in `scripts/` removes ones older than an hour when the owner runs it.
- **Public logs:** the repository is public, so Actions logs are public. The test's API helper reports only the method, path and status of a failed call, never a response body or the token.

## Revisit when

Gitea publishes a container image that runs in CI quickly enough to replace the personal server in the e2e layer.
