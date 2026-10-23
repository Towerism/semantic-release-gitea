/**
 * Gets the owner and repository name out of the `repositoryUrl` that
 * semantic-release was given.
 *
 * Gitea has no sub-groups, so the owner and the repository are always the last
 * two path segments. Anything before them is the folder the server is
 * installed under. When `giteaUrl` is known, an http(s) URL must carry exactly
 * that folder. An SSH URL never does, because Gitea hands out SSH remotes
 * without it.
 *
 * @param {string} repositoryUrl `https://host/owner/repo.git`, `git@host:owner/repo.git` or `ssh://git@host:2222/owner/repo.git`
 * @param {string} [giteaUrl] the configured server address
 * @returns {{ owner: string, repo: string } | null} `null` when the value has no owner and repository
 */
export function parseRepoUrl(repositoryUrl, giteaUrl) {
  if (typeof repositoryUrl !== 'string') return null;
  const value = repositoryUrl.trim();

  let path;
  let isHttp = false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    path = url.pathname;
    isHttp = url.protocol === 'http:' || url.protocol === 'https:';
  } else {
    const scp = /^(?:[^@\s/]+@)?[^:\s/]+:(?!\/\/)(.+)$/.exec(value);
    if (!scp) return null;
    path = scp[1];
  }

  const segments = path.split('/').filter(Boolean);
  const last = segments.pop()?.replace(/\.git$/, '');
  const owner = segments.pop();
  if (!owner || !last) return null;

  if (isHttp && giteaUrl) {
    const folder = serverFolder(giteaUrl);
    if (folder && folder.join('/') !== segments.join('/')) return null;
  }
  return { owner, repo: last };
}

/**
 * @param {string} giteaUrl
 * @returns {string[] | null} the path segments of the server address, or `null` if it is not a URL
 */
function serverFolder(giteaUrl) {
  try {
    return new URL(giteaUrl).pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }
}
