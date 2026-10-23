# ADR-0008: Open the failure issue without running the full verification

**Status:** accepted, 2026-10-22, by Towerism, the repository owner ("approve ADR-0008").

The `fail` step needs only a token, a server address and a repository. It does not run the checks of `verifyConditions` first. Every other step still does.

## Context

[The architecture](../architecture.md) says `index.js` verifies once and reuses the result, so no step acts on an unchecked setup. semantic-release calls `fail` after any step has failed, including `verifyConditions`. The failures worth an issue are often the ones the verification finds: an option with a bad value, an unsupported option, a token that cannot push, a server older than 28.2.0, a repository that was renamed. If `fail` ran the verification first, it would throw those same errors and open nothing, and the maintainer would have to find them in a CI log.

`@semantic-release/github` does not verify in its `fail` step either. It reads the repository to get its current name and then opens or updates the issue.

## Options

| Option | For | Against |
|---|---|---|
| Verify first, as the other steps do | One code path; a bad setup is reported once | `fail` throws instead of opening the issue in exactly the cases where verification failed |
| A lighter check: token, server address, repository | Reports most failures; costs one request | Options and checks verification would have made are skipped, so the step needs fallbacks |
| No check | Simplest | An unusable setup produces a confusing error from deep inside the step |

## Decision

A lighter check. `lib/connect.js` builds what `fail` needs:

- It applies this plugin's entry in the legacy `publish` option, as the other steps do.
- It requires `GITEA_TOKEN`, a server address and a repository in `repositoryUrl`. When any are missing it throws `ENOGITEATOKEN` or `EINVALIDGITEAURL`, naming every missing piece.
- It reads the repository once and uses the owner and name the server reports.

It does not read `GET /version` and does not check `permissions.push`.

Because verification did not look at the options, `fail` protects itself. An option of the wrong type is replaced by its default and logged. A `failComment` or `failCommentCondition` template that throws falls back to the default text, and the template's error is logged and added to the issue text. The token is removed from the issue and comment text, because release errors from git or other plugins can contain it.

## Consequences

A failed release is reported on Gitea in more cases than before. When there is no token, no server address or no usable repository URL, `fail` still cannot open an issue; it throws, and the original errors remain in semantic-release's own log.

`fail` can open an issue with a token that cannot push but can write issues. The GitHub plugin allows that too.

The architecture's statement that `index.js` verifies before each step changes to "every step but `fail`".

## Revisit when

semantic-release changes when it calls `fail`, or a failure that verification would have caught turns out to make `fail` misbehave in a way the fallbacks do not cover.
