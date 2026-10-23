/** The oldest Gitea server this plugin is tested against (docs/gitea-api-verification.md). */
export const MIN_GITEA_VERSION = '28.2.0';

export const DEFAULT_API_PREFIX = '/api/v1';

/** Package name, used to find this plugin's own entry in the `publish` option. */
export const PLUGIN_NAME = 'semantic-release-gitea';

/** What `publish` and `addChannel` call their result, so other plugins can tell the releases apart. */
export const RELEASE_NAME = 'Gitea release';

/** Time limit for one asset upload. The client's own 30 seconds is too short for a large file on a slow link. */
export const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
