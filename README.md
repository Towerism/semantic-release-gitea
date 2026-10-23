# semantic-release-gitea

A [semantic-release](https://github.com/semantic-release/semantic-release) plugin for projects hosted on a [Gitea](https://about.gitea.com/) server. It will do for Gitea what `@semantic-release/github` does for GitHub: publish a release, then comment on or open issues and pull requests.

**Status: not yet functional.** The package exports the five semantic-release steps (`verifyConditions`, `publish`, `addChannel`, `success` and `fail`), and each one currently fails with "not implemented". Do not use it in a real release yet. [docs/architecture.md](docs/architecture.md) describes what it will do.

## Usage

Once the steps work, a `.releaserc.json` will name the plugin like this:

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "semantic-release-gitea"
  ]
}
```

## Development

You need Node 22.14 or newer (or 24.10 or newer).

```bash
npm ci
npm run lint   # type-checks the JavaScript with tsc
npm test       # runs every test under test/ with node --test
```

The design decisions are in [docs/adr/](docs/adr/).

## Maintainer notes

These steps belong to the repository owner. They are not automated.

1. First publish. The npm package does not exist yet, so trusted publishing cannot be set up. Publish the placeholder version `0.0.0` once by hand from a logged-in shell with `npm publish`. It exists only to create the package.
2. Trusted publishing. After the first publish, open the package's settings on npmjs.com and add this repository (`Towerism/semantic-release-gitea`) and the workflow file `release.yml` as a trusted publisher.
3. No `v0.0.0` tag. Do not tag the placeholder. With no version tags in the repository, semantic-release's first automated release is `1.0.0`.
4. Turning releases on. The release workflow runs on every push to `main`. Its release job is skipped until you set the repository variable `RELEASES_ENABLED` to `true` (Settings, then Secrets and variables, then Actions, then Variables). Set it when v1 is ready.
5. Undoing a bad release. npm never lets you reuse a version. Mark it with `npm deprecate semantic-release-gitea@<version> "<reason>"` and ship a fix. Do not delete tags.
