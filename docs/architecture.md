# Architecture of semantic-release-gitea

**Status:** proposed, 2026-10-22. Not yet reviewed. Once reviewed, this document and the ADRs in `adr/` are the source of truth, and a departure needs a new or updated ADR.

This document is for the maintainer who will build the plugin and for anyone who later asks why it works the way it does. It describes a semantic-release plugin that does for a Gitea server what `@semantic-release/github` 12.0.10 does for GitHub: publish a release, and comment on or open issues and pull requests.

## The short answer

The plugin is a plain JavaScript package in ECMAScript module (ESM) format, with one small HTTP client over Gitea's REST (representational state transfer) API at `/api/v1`, using Node's built-in `fetch`. It implements the same five lifecycle steps as the GitHub plugin: `verifyConditions`, `publish`, `addChannel`, `success` and `fail`. Gitea has no GraphQL API, no discussions and no "make latest" flag, so three behaviors of the GitHub plugin change or go away (see [Differences from the GitHub plugin](#differences-from-the-github-plugin)).

The two existing Gitea plugins cover less. `@saithodev/semantic-release-gitea` 2.1.0 (last published 2022) implements verify, publish and addChannel. `@forge-for-gitea/semantic-release-gitea` 1.2.0 implements verify and publish. Neither comments on released issues or opens a failure issue. [ADR-0001](adr/0001-build-a-new-plugin.md) records why we build a new plugin.

## How it works

semantic-release calls a plugin's exported functions at fixed steps. Each function gets the plugin's own config and a shared `context` (environment, logger, `nextRelease`, `commits`, `branch`, `errors` and so on).

```text
index.js            exports the five lifecycle functions; verifies once, then reuses the result
lib/
  resolve-config.js merges plugin options with environment variables and defaults
  verify.js         validates options, then checks URL, token, repo access and write permission
  publish.js        creates the release (draft first when there are assets) and uploads assets
  add-channel.js    finds the release for a tag and updates it, or creates it
  success.js        finds pull requests and issues in the release and comments on them
  fail.js           opens or updates the "release is failing" issue
  client.js         the only module that calls fetch: auth header, retry, errors, pagination
  repo-url.js       turns the repository URL into owner and repo (see Open questions for sub-path hosts)
  labels.js         resolves label names to Gitea's numeric IDs and creates missing labels
  definitions/      error codes and messages, constants
```

`client.js` is the single seam to the network. Every other module takes a client as an argument, so tests can pass a fake (ADR-0002).

### What each lifecycle step calls

| Step | What it does | Gitea endpoints |
|---|---|---|
| `verifyConditions` | Validates options. Checks the token is valid, the repo exists, the repo was not renamed, and the token can push. | `GET /repos/{owner}/{repo}` (returns `permissions.push` and `clone_url`) |
| `publish` | Creates the release. With assets: creates a draft, uploads each asset, then sets `draft: false`. | `POST /repos/{owner}/{repo}/releases`, `POST …/releases/{id}/assets?name=`, `PATCH …/releases/{id}` |
| `addChannel` | Updates the existing release for a tag (pre-release flag, name), or creates it when none exists. | `GET …/releases/tags/{tag}`, `PATCH …/releases/{id}`, `POST …/releases` |
| `success` | Finds pull requests that contain the released commits, and issues they or the commit messages close. Comments and labels each one. | `GET …/commits/{sha}/pull`, `GET …/pulls/{n}/commits`, `POST …/issues/{n}/comments`, `POST …/issues/{n}/labels`, `GET`/`POST …/labels` |
| `fail` | Finds the open failure issue by label and hidden marker. Comments on it, or opens one. Labels are resolved to numeric IDs first, creating missing ones with a colour. | `GET`/`POST …/labels`, `GET …/issues?state=open&type=issues&labels=`, `POST …/issues`, `POST …/issues/{n}/comments` |

All endpoint shapes above come from memory of the Gitea API and from the two existing plugins. They are not yet checked against the target server. Verifying them is the first piece of work (see [Open questions](#open-questions)). Three behaviors are most at risk: whether `labels` on issue create takes IDs rather than names, whether the per-commit pull request endpoint covers merge-commit and rebase merges, and whether a draft release can be fetched by tag.

### Configuration

Options keep the GitHub plugin's names where Gitea has an equivalent: `assets`, `successComment`, `successCommentCondition`, `failTitle`, `failComment`, `failCommentCondition`, `labels`, `assignees`, `releasedLabels`, `addReleases`, `draftRelease`, `releaseNameTemplate`, `releaseBodyTemplate`, `proxy`. Someone moving a `.releaserc` from GitHub changes only the plugin name and the URL options.

| Setting | Source | Notes |
|---|---|---|
| Token | `GITEA_TOKEN` env var | Required. Sent as `Authorization: token <value>`. Never read from plugin options, so it cannot end up in a committed config file. |
| Server URL | `giteaUrl` option, else `GITEA_URL` env var | Required. Example: `https://vcs.martinfrackerjr.com`. No default, because there is no canonical Gitea host. `giteaApiUrl` overrides the whole API base and has no env var. |
| API prefix | `giteaApiPrefix` option, else `GITEA_PREFIX` env var | Default `/api/v1`. |
| Owner and repo | Parsed from `options.repositoryUrl` | Handles `https://host/owner/repo.git` and `git@host:owner/repo.git`. Checked against `clone_url` to catch renames. |

Options that the GitHub plugin has and Gitea cannot honor (`discussionCategoryName`) fail verification with an error that names the option. They are never silently ignored. ADR-0004 has the reasoning.

### Errors

Each failure has a stable `E…` code and a message with a details paragraph, thrown as `SemanticReleaseError` and collected into an `AggregateError`, the same way the GitHub plugin does. That keeps the output format users already know. Codes: `EINVALID<OPTION>` per option, `EINVALIDGITEAURL`, `ENOGITEATOKEN`, `EINVALIDGITEATOKEN`, `EMISSINGREPO`, `EGITEANOPERMISSION`, `EMISMATCHGITEAURL`, `EUNSUPPORTEDOPTION`.

## Why it was done this way

Four constraints shaped the design.

1. **Gitea's API is smaller than GitHub's.** There is no GraphQL, so the GitHub plugin's single query for "pull requests associated with these commits" becomes one `GET /commits/{sha}/pull` call per commit (ADR-0005).
2. **Ten or so endpoints are needed.** A generated software development kit (SDK) or a large client library adds more code than it saves (ADR-0002).
3. **Users will move configs from GitHub.** Matching option names and error shapes lowers the cost of trying the plugin (ADR-0004).
4. **The only real test is a real server.** Mocks drift from Gitea's behavior, and Gitea changes between releases. The test plan has a fast unit layer and an opt-in layer against a live server (ADR-0006).

## Differences from the GitHub plugin

| GitHub plugin | This plugin | Why |
|---|---|---|
| `make_latest` on release create | Dropped. Gitea marks the newest non-draft, non-pre-release as latest itself. | The field does not exist in Gitea's release API. |
| `discussionCategoryName` | Rejected by verify with `EUNSUPPORTEDOPTION` | Gitea has no release discussions. |
| GraphQL for associated PRs and for finding failure issues | REST calls, with a bounded number in flight at once | No GraphQL in Gitea. |
| Octokit retry and throttling plugins | Small retry on network errors, 429 and 5xx, honoring `Retry-After` | Gitea has no rate-limit headers by default. |
| Permission check skipped under GitHub Actions | Always checks `permissions.push` | Gitea Actions tokens do return permissions. This must be confirmed on the server. |
| `issue-parser` `github` preset | Same preset with `hosts: [giteaUrl]` | Gitea uses `#N` and full-URL references in the same form. Needs confirming. |

## Trade-offs and limits

- `success` costs one request per released commit plus one per candidate pull request. A release of 200 commits makes a few hundred calls. That is acceptable for a release job that runs once, and the in-flight limit keeps it from flooding a small self-hosted server. A cache by pull-request number avoids repeat lookups.
- Targeting Gitea's current stable release means older servers may lack `GET /commits/{sha}/pull` (added in 1.16, from memory). Verify reads `GET /version` and reports a clear error below the supported minimum, which is set after the first server check.
- On GitHub, a pull request can be linked to its commits by several routes. On Gitea, the per-commit endpoint probably maps only the commit the merge recorded, so squash merges work best, and merge-commit and rebase merges may miss pull requests. A `(#N)` reference in the commit subject is a second source (ADR-0005). Coverage is unverified.

## Open questions

1. What Gitea version does `vcs.martinfrackerjr.com` run, and does it accept the endpoints in the table above? An anonymous `curl` of `/api/v1/version` on 2026-10-22 returned `403 Only signed in user is allowed to call APIs`, so a token is needed. Whoever has the server needs to create one with `write:repository` and `write:issue` scopes, on a throwaway repository.
2. Package name: ADR-0007 proposes the unscoped `semantic-release-gitea`, free on npm on 2026-10-22. The repository is `Towerism/semantic-release-gitea` on GitHub, and the plugin releases itself with semantic-release.
3. Licence: MIT, to match the code this design follows and to allow reuse of its logic with attribution.
4. Does the "Do not check permissions under CI" exception need a Gitea Actions equivalent? Decide after testing a token issued by an Actions runner. Also check how the built-in token is named there (ADR-0004).
5. Repository URLs on a Gitea server installed under a sub-path (`https://host/gitea/owner/repo`) or in the form `ssh://git@host:2222/owner/repo.git` cannot be parsed by the GitHub plugin's rules. Derive the base from `giteaUrl` when set, and test both forms.
6. Settled 2026-10-22: the owner agreed the personal server's hostname may stay in this public repository.
7. Does `verifyConditions` copy options from a `publish` plugin entry, as the GitHub plugin does? Decide whether to keep that, since it matters when a user lists the plugin twice.

## Related

- [ADR-0001: Build a new plugin](adr/0001-build-a-new-plugin.md)
- [ADR-0002: Use a thin client over native fetch](adr/0002-thin-client-over-native-fetch.md)
- [ADR-0003: ESM JavaScript on current Node, no build step](adr/0003-esm-javascript-no-build-step.md)
- [ADR-0004: Match the GitHub plugin's options, reject the unsupported ones](adr/0004-option-compatibility.md)
- [ADR-0005: Find pull requests with per-commit REST calls](adr/0005-find-pull-requests-with-rest.md)
- [ADR-0006: Test with fakes by default and a live Gitea on demand](adr/0006-test-strategy.md)
- [ADR-0007: Publish to npm from GitHub Actions with semantic-release](adr/0007-publish-to-npm.md)
- Source followed: [`@semantic-release/github` 12.0.10](https://github.com/semantic-release/github)
