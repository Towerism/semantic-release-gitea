# ADR-0005: Find pull requests with per-commit REST calls

**Status:** accepted, 2026-10-22, by Towerism, the repository owner ("approve architecture and all ADRs").

The `success` step finds pull requests with `GET /repos/{owner}/{repo}/commits/{sha}/pull` for each released commit, with at most a fixed number of requests in flight.

## Context

The GitHub plugin asks one GraphQL query for the pull requests associated with up to 100 commits at a time. Gitea has no GraphQL. It does have the per-commit endpoint. From memory, it looks the pull request up by merged commit ID, so it returns the pull request only for the commit the merge recorded: the merge commit, the squash commit or the last rebased commit. It may not return the pull request for each individual commit inside a merge-commit pull request. All of this is unverified. Issues named in commit messages (`Closes #12`) are found by parsing the messages and need no lookups beyond fetching the issue.

## Options

| Option | For | Against |
|---|---|---|
| Per-commit REST, bounded concurrency | Simple; exact | Many requests for big releases |
| List all recent pull requests and match merge SHAs | Few requests | Misses old PRs; paging cost grows with repo age |
| Only parse issue references from commit messages | No PR lookups | Skips comments on pull requests, which the GitHub plugin does |

## Decision

Per-commit REST with a limit of 5 requests in flight (configurable later), de-duplicated by pull request number. Pull requests are found from two sources: the per-commit endpoint, and a `(#N)` reference at the end of a commit subject, which squash merges on Gitea add. The GitHub plugin's fallback (keep a pull request if one of its commits, or its merge commit, is in the release) still applies to filter out wrong matches, but on Gitea the risk is missed pull requests, not extra ones. The first spike measures coverage for merge, squash and rebase merges, and this decision is revised with the result. Comments go through `POST /issues/{n}/comments`, because Gitea treats pull requests as issues for comments and labels.

## Consequences

Cost scales with release size. The `successCommentCondition` option can switch the step off for repositories where it is too slow. A failure on one pull request is collected and reported at the end; it does not stop the other comments (the GitHub plugin behaves the same way).

## Revisit when

A release regularly exceeds a thousand commits, or Gitea adds a batch endpoint.
