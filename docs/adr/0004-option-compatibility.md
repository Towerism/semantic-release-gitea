# ADR-0004: Match the GitHub plugin's options, reject the unsupported ones

**Status:** proposed, 2026-10-22. Awaiting review by Towerism, the repository owner.

Option names, defaults and error shapes follow `@semantic-release/github` where Gitea has an equivalent. An option Gitea cannot honor makes verification fail, rather than being ignored.

## Context

People who run semantic-release on GitHub and move a repository to Gitea already have a `.releaserc`. The two options with no Gitea equivalent are `discussionCategoryName` (Gitea has no release discussions) and, internally, `make_latest`. URL options need Gitea names: GitHub's `githubUrl`, `githubApiUrl` and `githubApiPathPrefix` do not apply.

## Options

| Option | For | Against |
|---|---|---|
| Own option set | Shaped to Gitea | Users relearn everything; docs for the GitHub plugin stop helping |
| Same names, silently ignore unsupported | Config moves with no edits | A release that quietly skips something the user asked for |
| Same names, rename URL options, fail on unsupported | Familiar; honest | One edit for URLs; a failed verify the first time |

## Decision

Same names and defaults, with `giteaUrl`, `giteaApiUrl` (full override) and `giteaApiPrefix` replacing the GitHub URL options. Environment variables: `GITEA_TOKEN`, `GITEA_URL`, `GITEA_PREFIX`. Unsupported options throw `EUNSUPPORTEDOPTION` in `verifyConditions`, before any release happens. The token is read only from the environment.

## Consequences

The GitHub plugin's README is a usable guide for most options. We document the differences in one table. We do not read `GH_TOKEN` or `GITHUB_TOKEN`, so a leftover GitHub token is never sent to a Gitea server. Under Gitea Actions the built-in credential is exposed as `GITHUB_TOKEN`, and Gitea reserves secret names that start with `GITEA_` or `GITHUB_` (both from memory, unverified). The README must show the mapping, `env: GITEA_TOKEN: ${{ secrets.RELEASE_TOKEN }}` or `${{ gitea.token }}`, and the first spike must check which works.

## Revisit when

Gitea adds release discussions or a latest flag, or users ask for `GITHUB_*` fallback variables.
