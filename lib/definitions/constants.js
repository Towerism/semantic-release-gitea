/** The oldest Gitea server this plugin is tested against (docs/gitea-api-verification.md). */
export const MIN_GITEA_VERSION = '28.2.0';

export const DEFAULT_API_PREFIX = '/api/v1';

/** Package name, used to find this plugin's own entry in the `publish` option. */
export const PLUGIN_NAME = 'semantic-release-gitea';

/** What `publish` and `addChannel` call their result, so other plugins can tell the releases apart. */
export const RELEASE_NAME = 'Gitea release';

/** Hidden line in the body of every failure issue, so the plugin can tell its own issues from others that carry the same labels. */
export const FAILURE_MARKER = '<!-- semantic-release:gitea -->';

/** Label on every failure issue, whatever the `labels` option says. */
export const FAILURE_LABEL = 'semantic-release';

/** Colour for a label the plugin has to create. Neutral grey, so it does not look like a status. */
export const LABEL_COLOR = 'ededed';

/** Most requests `success` has in flight at once, so a small self-hosted server is not flooded (ADR-0005). */
export const MAX_IN_FLIGHT = 5;

/** Time limit for one asset upload. The client's own 30 seconds is too short for a large file on a slow link. */
export const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
