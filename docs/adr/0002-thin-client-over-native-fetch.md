# ADR-0002: Use a thin client over native fetch

**Status:** accepted, 2026-10-22, by Towerism, the repository owner ("approve architecture and all ADRs").

All Gitea calls go through one module, `lib/client.js`, built on Node's global `fetch`. We add no HTTP or SDK dependency.

## Context

The plugin needs about ten endpoints (see the architecture document). It must work through an HTTP proxy, send multipart uploads for assets, retry transient failures and page through list results. Tests need to replace the network without patching modules.

## Options

| Option | For | Against |
|---|---|---|
| `gitea-js` SDK | Typed, generated from Gitea's OpenAPI spec | Tied to a Gitea version's spec; large surface for ten calls; its types lag the server we run |
| Octokit with a base URL | Matches upstream code | Octokit's route table is GitHub's; Gitea paths and bodies differ, so we would fight it |
| `undici` directly | Proxy and pooling control | Another dependency; Node ships it already |
| Native `fetch` plus a small wrapper | No HTTP or SDK dependency, trivial to fake | We write retry, paging and proxy support ourselves |

## Decision

Native `fetch` with a wrapper of roughly 150 lines: base URL and auth header, JSON in and out, retry with backoff (GET, HEAD, PATCH and DELETE on network errors, 429 and 5xx; POST only on 429 or on a connection error before the request was sent, so a timeout or 502 cannot create a duplicate release, comment or issue), `Link`-header paging, and typed errors carrying status and response body. Proxy support uses `fetch` and `ProxyAgent` imported together from the `undici` package, an optional peer dependency, because a dispatcher from one undici version can fail when passed to Node's built-in `fetch` from another. The plugin imports undici only when a proxy is configured, either by the `proxy` option or, as in the GitHub plugin, by `http_proxy` or `HTTP_PROXY`. Verification fails with a clear message if it is missing.

The client is created once per lifecycle step and passed down. Tests pass a stub with the same interface.

## Consequences

Fewer dependencies to audit than an SDK or Octokit would add. The ported logic still needs a few small ones (lodash templates, `issue-parser`, a glob library, `mime`, `aggregate-error`, `@semantic-release/error`, `debug`). We carry the retry and paging code and its tests. When Gitea changes a response shape, one file changes.

## Revisit when

The wrapper grows past a few hundred lines, or the endpoint count passes about twenty.
