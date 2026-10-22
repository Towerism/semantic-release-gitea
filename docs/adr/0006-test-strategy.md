# ADR-0006: Test with fakes by default and a live Gitea on demand

**Status:** proposed, 2026-10-22. Awaiting review by Towerism, the repository owner.

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
3. **End-to-end tests** run only when `GITEA_E2E_URL` and `GITEA_E2E_TOKEN` are set. Each run creates a repository named `sr-e2e-<timestamp>` under a test user, runs `semantic-release` for real through `verify`, `publish`, `addChannel`, `success` and `fail`, checks the results through the API, and deletes the repository. The token is a dedicated one with repository and issue scopes, created for this purpose.

Development follows red-green-refactor, test first.

## Consequences

The e2e layer is our protection against Gitea changes. Fixtures need an occasional refresh, which the script makes one command. GitHub Actions runs the unit and contract layers on every pull request and never holds a token for the personal server. The e2e layer runs only from the maintainer's shell. If it ever moves to CI, it will be a manually triggered workflow on a self-hosted runner. The token never enters the repository.

## Revisit when

Gitea publishes a container image that runs in CI quickly enough to replace the personal server in the e2e layer.
