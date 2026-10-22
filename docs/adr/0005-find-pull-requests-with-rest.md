# ADR-0005: Find pull requests with per-commit REST calls

**Status:** proposed, 2026-10-22. Awaiting review by Martin Fracker Jr.

The `success` step finds pull requests with `GET /repos/{owner}/{repo}/commits/{sha}/pull` for each released commit, with at most a fixed number of requests in flight.

## Context

The GitHub plugin asks one GraphQL query for the pull requests associated with up to 100 commits at a time. Gitea has no GraphQL. It does have the per-commit endpoint, which returns the pull request that merged the commit (from memory; to check on the target server). Issues named in commit messages (`Closes #12`) are found by parsing the messages and need no lookups beyond fetching the issue.

## Options

| Option | For | Against |
|---|---|---|
| Per-commit REST, bounded concurrency | Simple; exact | Many requests for big releases |
| List all recent pull requests and match merge SHAs | Few requests | Misses old PRs; paging cost grows with repo age |
| Only parse issue references from commit messages | No PR lookups | Skips comments on pull requests, which the GitHub plugin does |

## Decision

Per-commit REST with a limit of 5 requests in flight (configurable later), de-duplicated by pull request number, with the GitHub plugin's fallback: keep a pull request if one of its commits, or its merge commit, is in the release. Comments go through `POST /issues/{n}/comments`, because Gitea treats pull requests as issues for comments and labels.

## Consequences

Cost scales with release size. The `successCommentCondition` option can switch the step off for repositories where it is too slow. A failure on one pull request is collected and reported at the end; it does not stop the other comments (the GitHub plugin behaves the same way).

## Revisit when

A release regularly exceeds a thousand commits, or Gitea adds a batch endpoint.
