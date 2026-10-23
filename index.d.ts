/** Settings that go on this plugin's entry in the semantic-release config. */
export interface PluginConfig {
  /** Address of the Gitea server, such as `https://git.example`. Falls back to `GITEA_URL`. */
  giteaUrl?: string;
  /** Full API address. Replaces `giteaUrl` plus `giteaApiPrefix`. */
  giteaApiUrl?: string;
  /** Path of the API under the server address. Falls back to `GITEA_PREFIX`, then `/api/v1`. */
  giteaApiPrefix?: string;
  /** Proxy URL, a host and port, or `false` to ignore `http_proxy` and `HTTP_PROXY`. */
  proxy?: string | { host: string; port: number } | false;
  assets?: Array<string | string[] | { path: string | string[]; name?: string; label?: string }> | string;
  successComment?: string | false;
  successCommentCondition?: string | false;
  failTitle?: string | false;
  failComment?: string | false;
  failCommentCondition?: string | false;
  labels?: string[] | string | false;
  assignees?: string[] | string;
  releasedLabels?: string[] | string | false;
  addReleases?: 'top' | 'bottom' | false;
  draftRelease?: boolean;
  releaseBodyTemplate?: string;
  releaseNameTemplate?: string;
  /** Not supported on Gitea. Any value other than `false` fails verification. */
  discussionCategoryName?: string | false;
}

export interface Logger {
  log: (message: string, ...values: unknown[]) => void;
  warn: (message: string, ...values: unknown[]) => void;
  error: (message: string, ...values: unknown[]) => void;
  success: (message: string, ...values: unknown[]) => void;
}

export interface NextRelease {
  version: string;
  gitTag: string;
  gitHead: string;
  channel?: string | null;
  notes?: string;
  name?: string;
  type?: string;
}

/** What semantic-release passes to every step. Only the fields this plugin reads are listed. */
export interface Context {
  cwd?: string;
  env: Record<string, string | undefined>;
  logger: Logger;
  options: {
    repositoryUrl: string;
    /** Plugin entries given to the legacy top-level `publish` option. */
    publish?: Array<string | { path?: string } & PluginConfig> | string | ({ path?: string } & PluginConfig);
  };
  nextRelease?: NextRelease;
  branch?: { name: string; channel?: string | null; prerelease?: boolean | string };
  commits?: Array<{ hash: string; message: string }>;
  errors?: Error[];
}

/** What `publish` and `addChannel` report about the release they made or changed. */
export interface ReleaseInfo {
  /** Address of the release page on the Gitea server. */
  url: string;
  /** Always `Gitea release`, so other plugins can tell this release from their own. */
  name: string;
  /** The release's number on Gitea. Only `publish` returns it. */
  id?: number;
}

export function verifyConditions(pluginConfig: PluginConfig, context: Context): Promise<void>;
export function publish(pluginConfig: PluginConfig, context: Context): Promise<ReleaseInfo>;
export function addChannel(pluginConfig: PluginConfig, context: Context): Promise<ReleaseInfo>;
export function success(pluginConfig: PluginConfig, context: Context): Promise<void>;
export function fail(pluginConfig: PluginConfig, context: Context): Promise<void>;
