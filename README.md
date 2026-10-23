# semantic-release-gitea

A [semantic-release](https://github.com/semantic-release/semantic-release) plugin for projects hosted on a [Gitea](https://about.gitea.com/) server. It will do for Gitea what `@semantic-release/github` does for GitHub: publish a release, then comment on or open issues and pull requests.

**Status: not yet functional.** `verifyConditions`, `publish` and `addChannel` are built. They check your setup, create the release on Gitea with its files, and move a release to another channel. The other two steps, `success` and `fail`, are not implemented and reject with "not implemented", so do not use the plugin in a real release yet. [docs/architecture.md](docs/architecture.md) describes what it will do.

## Usage

A `.releaserc.json` names the plugin like this:

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["semantic-release-gitea", { "giteaUrl": "https://git.example" }]
  ]
}
```

You need a Gitea server running version 28.2.0 or newer, and an access token that can write to the repository (the `write:repository` and `write:issue` scopes).

## What `verifyConditions` checks

Before any release step runs, the plugin reports every problem it finds in one message. It checks, in this order:

1. Every option has a valid value.
2. No unsupported option is set. `discussionCategoryName` (Gitea has no release discussions) fails with `EUNSUPPORTEDOPTION` unless it is `false`. A `giteaToken` option fails the same way, because the token may only come from the environment.
3. `GITEA_TOKEN` is set, and a server address and a usable `repositoryUrl` are known.
4. The server reports version 28.2.0 or newer (`GET /version`).
5. The token is accepted, the repository exists and has not been renamed, and the token can push (`GET /repos/{owner}/{repo}`).

A passing check is remembered for the rest of the run, so later steps do not repeat the two requests. `publish` and `addChannel` run it first if `verifyConditions` did not, so they never act on an unchecked setup.

## What `publish` and `addChannel` do

`publish` creates the release for the new version. Its name comes from `releaseNameTemplate` and its notes from `releaseBodyTemplate`. Both are lodash templates (`<%= nextRelease.version %>`) that see the whole release context. The tag is the one semantic-release just pushed, and the release is marked as a pre-release when the branch is a pre-release or maintenance branch. Gitea picks the latest release itself, so there is no `make_latest`.

Without `assets`, one request creates the release. With `assets`, `publish` creates it as a draft, uploads each file one at a time, then publishes it, so a server that reacts to the release sees the files already attached. Set `draftRelease` to `true` to leave it as a draft. Everything that can fail without the server (a bad template, finding the files) is checked before the first request, so a mistake there leaves nothing on the server.

`assets` takes the same values as the GitHub plugin: a glob string, an array of globs (a `!` pattern in the array removes files), or an object with a `path` and an optional `name`. The `name` is a template. A `path` that matches several files uploads each under its own file name. Files are sent as the multipart field `attachment`, with up to 10 minutes allowed for each upload. A path that does not exist, or is not a file, is logged and skipped, and the release still goes out. Paths are not confined to the project folder, and a symlink is followed, so check what your globs match. A `name` template that renders empty or with a `/` fails before anything is sent. An asset `label` has no equivalent on Gitea, so it is ignored with a warning.

If anything fails after the draft exists (an upload, reading a file, the final publish), the draft stays on the server and the log gives its address. Delete it before you run the release again, because Gitea refuses a second release for the same tag until you do.

`addChannel` runs when a version is added to another channel. It finds the release by tag and updates its name and pre-release flag. It leaves the notes and draft state alone. When there is no release for the tag, it creates one from the release notes.

Both steps return `{ url, name: "Gitea release" }` (and `id` for `publish`), the shape semantic-release hands to other plugins. Templates can read `env`, so a template can print the token into a release. Do not put it in one.

## Options

Option names follow `@semantic-release/github` where Gitea has an equivalent, so a config can move over with the plugin name and the URL options changed. The URL options, `proxy`, `assets`, `draftRelease`, `releaseNameTemplate` and `releaseBodyTemplate` are used today. The rest are checked now and used by the steps that are not built yet.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `giteaUrl` | string | `GITEA_URL` | Address of the Gitea server, such as `https://git.example`. Include the sub-path if Gitea is installed under one. Required unless `giteaApiUrl` is set. |
| `giteaApiUrl` | string | none | Full API address. Replaces `giteaUrl` plus `giteaApiPrefix`. |
| `giteaApiPrefix` | string | `GITEA_PREFIX`, else `/api/v1` | Path of the API under `giteaUrl`. |
| `proxy` | string, `{ host, port }` or `false` | `http_proxy`, then `HTTP_PROXY`, else `false` | Proxy for all requests. Needs the optional `undici` package. |
| `assets` | array | none | Files to attach to the release: globs, arrays of globs, or objects with a `path` and optional `name` (a template). A `label` is ignored. |
| `successComment` | string or `false` | none | Template for the comment on released issues and pull requests. |
| `successCommentCondition` | string or `false` | none | Template that decides whether to comment. |
| `failTitle` | string or `false` | `The automated release is failing 🚨` | Title of the issue opened when a release fails. |
| `failComment` | string or `false` | none | Template for the comment on that issue. |
| `failCommentCondition` | string or `false` | none | Template that decides whether to open or update it. |
| `labels` | array or `false` | `["semantic-release"]` | Labels for the failure issue. |
| `assignees` | array | none | Users to assign to the failure issue. |
| `releasedLabels` | array or `false` | `released` (plus ` on @channel` for a channel) | Labels added to released issues and pull requests. |
| `addReleases` | `"top"`, `"bottom"` or `false` | `false` | Whether to list other releases in the release notes. Applied by `success`, which is not built yet. |
| `draftRelease` | boolean | `false` | Leave the release as a draft instead of publishing it. |
| `releaseBodyTemplate` | string | `<%= nextRelease.notes %>` | Template for the release notes. |
| `releaseNameTemplate` | string | `<%= nextRelease.name %>` | Template for the release name. |
| `discussionCategoryName` | `false` | `false` | Not supported. Any other value fails with `EUNSUPPORTEDOPTION`. |

The legacy top-level `publish` option may also list this plugin, as an entry whose `path` is `semantic-release-gitea`. The plugin checks that entry too. It copies `assets`, `successComment`, `failComment`, `failTitle`, `labels`, `assignees` and `discussionCategoryName` from it when its own config leaves them out.

## Environment variables

| Variable | Meaning |
|---|---|
| `GITEA_TOKEN` | Required. The Gitea access token. It is read only from the environment, so it cannot end up in a committed config file. `GH_TOKEN` and `GITHUB_TOKEN` are never read, so a leftover GitHub token is never sent to your server. |
| `GITEA_URL` | Server address, used when `giteaUrl` is not set. |
| `GITEA_PREFIX` | API path, used when `giteaApiPrefix` is not set. Default `/api/v1`. |
| `http_proxy`, `HTTP_PROXY` | Proxy, used when `proxy` is not set. |

A token sent to an `http://` server travels in cleartext. Use `https://` unless the server is on a network you trust.

### Gitea Actions

The token that Gitea Actions creates for a job is not an environment variable, and Gitea reserves secret and variable names that start with `GITEA_` or `GITHUB_`. Map it in the workflow yourself:

```yaml
- run: npx semantic-release
  env:
    GITEA_TOKEN: ${{ gitea.token }}        # the job's built-in token
    # GITEA_TOKEN: ${{ secrets.RELEASE_TOKEN }}   # or a secret you created
```

The built-in token reports its permissions, so the push check runs under Actions too.

### Using a proxy

A proxy needs the `undici` package, installed next to semantic-release (`npm install undici`). It is an optional peer dependency, loaded only when a proxy is set. A runner that has `HTTP_PROXY` set but no `undici` fails verification with `EMISSINGPROXYPACKAGE`. Set `proxy: false` to ignore the variable.

## Errors

Each problem has a stable code. The message says what is wrong and how to fix it.

| Code | Meaning |
|---|---|
| `EINVALID<OPTION>` | An option has an invalid value, such as `EINVALIDLABELS`. |
| `EINVALIDGITEAURL` | No server address, an unusable address, or a `repositoryUrl` without an owner and repository. |
| `ENOGITEATOKEN` | `GITEA_TOKEN` is not set. |
| `EINVALIDGITEATOKEN` | The server rejected the token. |
| `EMISSINGREPO` | The repository was not found. |
| `EGITEANOPERMISSION` | The token cannot push to the repository. |
| `EMISMATCHGITEAURL` | The repository was renamed or moved. |
| `EUNSUPPORTEDOPTION` | An option Gitea cannot honor, or a `giteaToken` option. |
| `EUNSUPPORTEDGITEAVERSION` | The server is older than 28.2.0, or its version cannot be read. |
| `EMISSINGPROXYPACKAGE` | A proxy is set but `undici` is not installed. |

## Development

You need Node 22.14 or newer (or 24.10 or newer).

```bash
npm ci
npm run lint   # type-checks the JavaScript with tsc
npm test       # runs every test under test/ with node --test
```

To run the end-to-end test against a Gitea server, set `GITEA_E2E_URL` (the server address) and `GITEA_E2E_TOKEN` (a token of the `testing` user) and run `node --test test/e2e.test.mjs`. Without them it is skipped. In CI, `.github/workflows/e2e.yml` runs it on `workflow_dispatch` and on pushes to `main`, and fails if either value is missing.

The design decisions are in [docs/adr/](docs/adr/).

## Maintainer notes

These steps belong to the repository owner. They are not automated.

1. First publish. The npm package does not exist yet, so trusted publishing cannot be set up. Publish the placeholder version `0.0.0` once by hand from a logged-in shell with `npm publish`. It exists only to create the package.
2. Trusted publishing. After the first publish, open the package's settings on npmjs.com and add this repository (`Towerism/semantic-release-gitea`) and the workflow file `release.yml` as a trusted publisher.
3. No `v0.0.0` tag. Do not tag the placeholder. With no version tags in the repository, semantic-release's first automated release is `1.0.0`.
4. Turning releases on. The release workflow runs on every push to `main`. Its release job is skipped until you set the repository variable `RELEASES_ENABLED` to `true` (Settings, then Secrets and variables, then Actions, then Variables). Set it when v1 is ready.
5. Undoing a bad release. npm never lets you reuse a version. Mark it with `npm deprecate semantic-release-gitea@<version> "<reason>"` and ship a fix. Do not delete tags.
6. End-to-end variable. Set the repository Actions variable `GITEA_E2E_URL` to the address of the test Gitea server (Settings, then Secrets and variables, then Actions, then Variables).
7. End-to-end secret. Set the repository Actions secret `GITEA_E2E_TOKEN` to a token of the `testing` user with repository and issue scopes. A repository-level secret can be read by any workflow file on any branch, which is acceptable while you are the only collaborator. The variable is not secret: GitHub prints the server address in the step's log.
8. End-to-end workflow. `e2e.yml` runs on `workflow_dispatch` and on pushes to `main`, not on pull requests. After changing the variable, the secret or the workflow, start it by hand from the Actions tab and check that the log shows the test ran and no repository named `sr-e2e-` remains on the server.
