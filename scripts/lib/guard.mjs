// Checks that keep the spike from sending the token to the wrong place or
// deleting the wrong repository.

const HOUR_MS = 3600 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const TEST_USER = 'testing';

export function checkBaseUrl(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('GITEA_E2E_URL is not a valid URL');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('GITEA_E2E_URL must use https (http is allowed only for localhost)');
  }
  return url;
}

// Names of repositories left by a crashed run: owned by the test user, named
// sr-e2e-<milliseconds since epoch>, and more than an hour old.
export function staleRepos(repos, now) {
  return repos
    .filter((repo) => repo.owner?.login === TEST_USER)
    .map((repo) => ({ name: repo.name, match: /^sr-e2e-(\d+)$/.exec(repo.name) }))
    .filter(({ match }) => match && now - Number(match[1]) > HOUR_MS)
    .map(({ name }) => name);
}
