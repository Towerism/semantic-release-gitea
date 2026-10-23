# Gitea API verification

This page records what the Gitea API did when the checks in [issue #3](https://github.com/Towerism/semantic-release-gitea/issues/3) ran against the owner's server. Use it to see which claims in [the architecture](architecture.md) and the ADRs are now confirmed, which were corrected, and which are still open.

- **Gitea version tested:** 28.2.0, from `GET /api/v1/version`.
- **Date:** 2026-10-22.
- **Minimum supported version:** 28.2.0, the only version tested. One server cannot show that an older version works, and no Gitea release note is cited here for an older one.
- **Summary:** checks 1 to 9 and 11 ran. Check 10 ran in part: the secret-name rule is confirmed, and the built-in token name and its `permissions` result were not observed. Three results change the design: issue create takes numeric label IDs only, `issue-parser` ignores `/pulls/N` URLs, and a sub-path install breaks the repository URL parsing.

Gitea version numbers no longer start with `1.`. The architecture's older wording, "added in 1.16", cannot be compared with `28.2.0`, so the version check must compare the numbers it gets and not assume a `1.` prefix.

## How the checks ran

Checks 1 to 7 and 9 ran from `scripts/gitea-api-spike.mjs`. It creates a private repository named `sr-e2e-<timestamp>` under the `testing` user, runs the checks, and deletes the repository. Checks 8 and 11 ran offline from `scripts/offline-parse-spike.mjs`, with the placeholder host `gitea.example`. Check 10 is described below.

What the run needs:

- `GITEA_E2E_URL` and `GITEA_E2E_TOKEN` exported in the shell. The token belongs to the `testing` user and was never written to a file.
- A token that can create and delete repositories, and write issues, releases and labels. The test token had `write:repository`, `write:issue`, `write:organization`, `write:user`, `write:package`, `write:notification` and `write:misc`, with access to public, private and limited repositories. Deleting a repository worked with `write:repository`.

Responses were scrubbed in code before they were read: hostnames, emails, avatar URLs and user IDs are gone. Release, label, issue and pull request IDs are kept.

## Results

### 1. Server version

`GET /api/v1/version` returned 200 and `{"version":"28.2.0"}`. Confirmed.

### 2. Repository permissions and clone URL

`GET /repos/{owner}/{repo}` returned 200 with `permissions` of `admin`, `push` and `pull` all true, and a `clone_url` of the form `https://<host>/testing/<repo>.git`. Confirmed.

### 3. Releases and assets

| Step | Result |
|---|---|
| `POST …/releases` with `draft: true` | 201, release `draft: true`, `published_at: null` |
| `GET …/releases/tags/{tag}` on that draft | 200: **a draft release is found by tag** |
| `POST …/releases/{id}/assets?name=` with multipart field `attachment` | 201: `id`, `name`, `size`, `uuid`, `browser_download_url` |
| The same upload with field `file` | 500 with an empty message |
| `PATCH …/releases/{id}` with `draft: false` | 200; the asset's `browser_download_url` changes to the permanent `…/releases/download/<tag>/<name>` form |
| `PATCH …/releases/{id}` with `prerelease: true` | 200 |

The multipart field name is `attachment`. The upload response gives a temporary `/attachments/<uuid>` URL; the permanent URL appears only after the release is published.

### 4. Labels

| Question | Result |
|---|---|
| Label colour with `#` | 201, stored as `ee0701` |
| Label colour without `#` | 201, stored as `ee0701` |
| `POST …/issues` with `labels` as numeric IDs | 201, labels applied |
| `POST …/issues` with `labels` as names | **422**: `unable to unmarshal JSON string into Go int64` |
| `POST …/issues/{n}/labels` with names | 200 |
| `POST …/issues/{n}/labels` with IDs | 200 |

Issue create takes numeric IDs only. The plugin must resolve names to IDs first, as `lib/labels.js` already plans.

### 5. Issue search

`GET …/issues?state=open&type=issues&labels=<name>` returned 200 with the one matching issue. A search with `q=<marker>` also returned 200 with one match, and fetching the open issues and filtering by the body marker found it. All three methods work on this server. The `q` parameter can be ignored by a server without a search indexer, so the plugin should fetch and filter.

### 6. Pull request lookup by commit

`GET …/commits/{sha}/pull` was called for the commits of each merge style, using two commits per pull request. "Branch commits" are the commits on the pull request's own branch. "Base commits" are the commits the merge added to the base branch, which are the ones semantic-release sees.

| Merge style | Base commits | Result |
|---|---|---|
| Merge commit | merge commit, then the two branch commits | merge commit: 200, found the pull request. Both branch commits: 404, none |
| Squash | the squash commit | 200, found the pull request |
| Rebase | two rebased commits | the last rebased commit: 200, found the pull request. The first: 404, none |

The branch commits on the pull request's own branch returned 404 in all three styles. The endpoint finds a pull request only from the commit the merge recorded. Because the merge commit, the squash commit and the last rebased commit are all in the release's commit list, each style still finds its pull request. The commits it misses are the individual commits inside a merge-commit or rebase pull request.

### 7. Comments on pull requests

`POST …/issues/{n}/comments` on a pull request number returned 201 with the comment body and a `pull_request_url`. Confirmed.

### 8. `issue-parser` with the `github` preset

Run offline with `hosts` set to `gitea.example`:

| Input | Result |
|---|---|
| `Closes #12` | closes issue 12 |
| `Closes owner/repo#12` | closes issue 12 in `owner/repo` |
| `Closes https://gitea.example/owner/repo/issues/12` | closes issue 12 in `owner/repo` |
| `Closes https://gitea.example/owner/repo/pulls/12` | **nothing found** |
| `See https://gitea.example/owner/repo/pulls/12` | **nothing found** |
| `See #12 and #13` | references 12 and 13 |
| `Merge pull request #7 from owner/branch` | reference 7 |
| `fix(api): handle empty list (#9)` | reference 9 |

References by `#N`, `owner/repo#N` and `/issues/N` URLs work. Gitea pull request URLs use `/pulls/N`, which the preset does not read. The plugin can live without that form, but must not claim to support it.

### 9. Rate limits and errors

- A normal response carried no `Retry-After` and no `X-RateLimit-*` header. Only `Content-Type` was present among the allowed headers.
- An unknown route returned 404 with the plain body `404 page not found`.
- A bad token returned 401 with `{"message":"invalid username, password or token","url":"…/api/swagger"}`.
- A 429 or 5xx was not provoked, because the server is a personal one and no load was generated. The one 500 seen came from the wrong upload field name in check 3.

### 10. Gitea Actions

| Question | Result |
|---|---|
| Secret names starting with `GITEA_` or `GITHUB_` | **Confirmed reserved.** `PUT …/actions/secrets/GITEA_E2E_X` and `…/GITHUB_E2E_X` returned 400 `name cannot start with 'GITEA_' or 'GITHUB_'`. A name without those prefixes returned 201. The same rule and message apply to Actions variables. |
| Name of the built-in token | **Not observed.** |
| `permissions` on `GET /repos/{owner}/{repo}` for a runner token | **Not observed.** |

The last two need a workflow run, and the server has no runner registered: `GET …/actions/runners` returned an empty list at both the repository and user level. Actions is enabled, but nothing can execute a job. To finish check 10, register a runner, then run a small workflow in a throwaway `testing` repository that prints the names of the `GITEA_*` and `GITHUB_*` environment variables and calls `GET /repos/{owner}/{repo}` with the built-in token.

### 11. Repository URL forms

Run offline with the placeholder host `gitea.example`:

| Input | Owner and repo parsed | Correct |
|---|---|---|
| `https://gitea.example/owner/repo.git` | `owner`, `repo` | yes |
| `https://gitea.example/owner/repo` | `owner`, `repo` | yes |
| `git@gitea.example:owner/repo.git` | `owner`, `repo` | yes |
| `ssh://git@gitea.example:2222/owner/repo.git` | `owner`, `repo` | yes |
| `https://gitea.example/gitea/owner/repo.git` (sub-path) | `gitea`, `owner/repo` | **no** |
| `git@gitea.example:gitea/owner/repo.git` (sub-path) | `gitea`, `owner/repo` | **no** |

The `ssh://` form with a port parses correctly. A sub-path install breaks the parsing, so `lib/repo-url.js` must take the base from `giteaUrl` when it is set.
