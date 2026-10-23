# ADR-0007: Publish to npm from GitHub Actions with semantic-release

**Status:** accepted, 2026-10-22, by Towerism, the repository owner ("approve architecture and all ADRs").

**Amended:** 2026-10-22, by Towerism, the repository owner ("releases do run on every push. just not until v1 is ready. v0.0.0 will not be tagged."). See [Amendment: releases stay off until v1](#amendment-releases-stay-off-until-v1).

The package is published to the public npm registry as `semantic-release-gitea`. A GitHub Actions workflow on the `main` branch of `Towerism/semantic-release-gitea` runs semantic-release, which versions, tags, publishes to npm and creates the GitHub release.

## Context

The repository is public on GitHub and the package is meant for anyone running semantic-release against a Gitea server. On 2026-10-22 neither `semantic-release-gitea` nor `@towerism/semantic-release-gitea` existed on npm. Semantic-release plugins are found by package name in `.releaserc`, and an unscoped name `semantic-release-gitea` is the form users expect (`@semantic-release/*` is reserved for the project's own plugins).

## Options

| Option | For | Against |
|---|---|---|
| Unscoped `semantic-release-gitea` | Short; matches the usual plugin naming | Someone else could publish a similar name; no namespace |
| Scoped `@towerism/semantic-release-gitea` | Namespace is ours | Longer; users must find the scope |
| Long-lived npm token in GitHub secrets | Simple | A leaked token can publish any version |
| npm trusted publishing (OpenID Connect from GitHub Actions) with provenance | No stored token; releases link to the workflow run | Needs npm package settings configured after the first publish |

## Decision

Use the unscoped name `semantic-release-gitea`. The first publish is done once by hand (or with a short-lived token) to create the package. After that, configure npm trusted publishing for this repository and workflow, and publish with `--provenance`. The repository's own `.releaserc` uses `@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`, `@semantic-release/npm` and `@semantic-release/github`. Commits follow Conventional Commits, so every `feat`, `fix` or breaking change releases without a manual step.

## Consequences

Releases need no human once the workflow exists. The package ships only `index.js`, `lib/` and `index.d.ts` (set in `files`), plus the licence and README. The `engines` and peer dependency ranges in ADR-0003 become a public contract: raising the minimum Node version is a breaking change. The workflow needs `contents: write` (tags and releases), `id-token: write` (npm trusted publishing), and `issues: write` and `pull-requests: write` (the success comments and failure issues that `@semantic-release/github` posts).

## Amendment: releases stay off until v1

The decision above stands: the workflow runs semantic-release on every push to `main`. The owner added that no release happens until v1 is ready. The first publish is the placeholder `0.0.0`, made by hand, and it is not tagged. With no version tags in the repository, semantic-release's first automated release is `1.0.0`.

The workflow `release.yml` runs lint and test on every push, but its release job runs only when the repository variable `RELEASES_ENABLED` is `true`. Turning releases on is a repository setting and needs no code change. The README's maintainer notes list the manual steps.

Provenance is set by `NPM_CONFIG_PROVENANCE=true` in the workflow, not by `publishConfig`, because a manual publish from a laptop fails when `provenance` is set in the package.

## Revisit when

The unscoped name is taken before we publish, in which case we move to the scoped name, or npm changes its trusted-publishing requirements.
