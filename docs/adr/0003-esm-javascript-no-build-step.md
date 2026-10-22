# ADR-0003: ESM JavaScript on current Node, no build step

**Status:** proposed, 2026-10-22. Awaiting review by Martin Fracker Jr.

The package is plain ESM JavaScript with JSDoc types, checked by `tsc --checkJs` and shipped as written. It supports the Node range that semantic-release itself supports.

## Context

`@semantic-release/github` 12.0.10 is ESM with `"engines": {"node": "^22.14.0 || >= 24.10.0"}`. semantic-release 25 loads ESM plugins. A plugin is a few small files, and users read plugin source when something fails in their pipeline.

## Options

| Option | For | Against |
|---|---|---|
| TypeScript with a build | Strong types in source | Build and `dist/` to publish and debug; stack traces point at compiled code |
| CommonJS | Works on old Node | semantic-release 25 and the upstream plugin are ESM; `require` of ESM-only deps fails |
| ESM JavaScript, JSDoc types, `tsc --noEmit` | No build, types still checked, `index.d.ts` hand-written for options | JSDoc is noisier than TS syntax |

## Decision

ESM JavaScript with JSDoc. `tsc --noEmit --checkJs` runs in lint. The Node range is copied from `@semantic-release/github` and updated when it changes. The peer dependency is `semantic-release >=24` (to be confirmed against the installed version in the first spike).

## Consequences

No build artefacts. Users on Node older than the range get a clear `engines` warning. Types for consumers come from a hand-written `index.d.ts` that covers the options.

## Revisit when

The codebase passes about 3,000 lines, or contributors ask for TypeScript.
