# ADR-0001: Build a new plugin

**Status:** accepted, 2026-10-22, by Towerism, the repository owner ("approve architecture and all ADRs").

We write a new semantic-release plugin for Gitea, following the structure of `@semantic-release/github`, instead of adopting or forking an existing Gitea plugin.

## Context

Two Gitea plugins are on npm. I read the source of both.

- `@saithodev/semantic-release-gitea` 2.1.0: CommonJS, targets Node 10 to 14 and later, last release 2021 (the 2.1.0 changelog entry is dated 2021-04-08). It has verify, publish and addChannel. No success or fail step.
- `@forge-for-gitea/semantic-release-gitea` 1.2.0: an ES module, published September 2025, uses the `gitea-js` client library. It has verify and publish only.

The goal is parity with the GitHub plugin, including the success comments and the failure issue. Neither plugin has those.

## Options

| Option | For | Against |
|---|---|---|
| Use `@forge-for-gitea` as is | No work | Missing addChannel, success and fail. Single maintainer, young. |
| Fork `@saithodev` | Has addChannel | Old code and dependencies; a rewrite in all but name. |
| Fork `@forge-for-gitea` and add steps | Modern base | Ties us to the `gitea-js` library (ADR-0002) and its layout. |
| New plugin that follows `@semantic-release/github` | Full parity, a layout maintainers of semantic-release already know, MIT-licensed source to follow | Most work up front. |

## Decision

Build new. The missing steps are the bulk of the work, so adopting either plugin saves little. Logic ported from `@semantic-release/github` keeps its copyright notice and the MIT licence text.

## Consequences

We own the maintenance, and our fixes do not flow to the other two plugins. The README states how this plugin differs from the other two.

## Revisit when

An existing plugin adds success and fail steps and is actively maintained, or semantic-release adds a first-party Gitea plugin.
