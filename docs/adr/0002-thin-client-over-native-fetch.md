# ADR-0002: Use a thin client over native fetch

**Status:** proposed, 2026-10-22. Awaiting review by Martin Fracker Jr.

All Gitea calls go through one module, `lib/client.js`, built on Node's global `fetch`. We add no HTTP or SDK dependency.

## Context

The plugin needs about ten endpoints (see the architecture document). It must work through an HTTP proxy, send multipart uploads for assets, retry transient failures and page through list results. Tests need to replace the network without patching modules.

## Options

| Option | For | Against |
|---|---|---|
| `gitea-js` SDK | Typed, generated from Gitea's OpenAPI spec | Tied to a Gitea version's spec; large surface for ten calls; its types lag the server we run |
| Octokit with a base URL | Matches upstream code | Octokit's route table is GitHub's; Gitea paths and bodies differ, so we would fight it |
| `undici` directly | Proxy and pooling control | Another dependency; Node ships it already |
| Native `fetch` plus a small wrapper | Zero runtime dependencies, trivial to fake | We write retry, paging and proxy support ourselves |

## Decision

Native `fetch` with a wrapper of roughly 150 lines: base URL and auth header, JSON in and out, retry on network errors, 429 and 5xx with backoff, `Link`-header paging, and typed errors carrying status and response body. Proxy support uses `ProxyAgent` from the `undici` package, which is an optional peer dependency. The plugin imports it only when the `proxy` option is set, and verification fails with a clear message if it is missing.

The client is created once per lifecycle step and passed down. Tests pass a stub with the same interface.

## Consequences

Fewer dependencies to audit. We carry the retry and paging code and its tests. When Gitea changes a response shape, one file changes.

## Revisit when

The wrapper grows past a few hundred lines, or the endpoint count passes about twenty.
