// Scrubs Gitea responses and errors before anything is printed or saved.
// The repository is public, so no token, hostname, email, avatar URL or user
// identity may reach the output. IDs of releases, labels, issues, pull
// requests and assets are observed data and stay.

const USER_KEYS = new Set(['owner', 'user', 'poster', 'author', 'merged_by', 'assignee', 'assignees']);
const USER_FIELDS = ['id', 'login', 'username', 'full_name'];
const DROPPED_KEYS = new Set(['email', 'avatar_url', 'user_id', 'uid', 'owner_id']);
const HEADER_ALLOWLIST = [/^retry-after$/, /^content-type$/, /^x-ratelimit-/];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeScrubber({ token, host }) {
  const hostPattern = host ? new RegExp(escapeRegExp(host), 'gi') : null;

  function scrubString(text) {
    let out = text;
    if (token) out = out.split(token).join('<token>');
    if (hostPattern) out = out.replace(hostPattern, '<host>');
    return out
      .replace(/\b(https?|ssh):\/\/[^/\s"'<>]+/gi, '$1://<host>')
      .replace(/https?:\/\/\S*avatar\S*/gi, '<avatar-url>')
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');
  }

  function walk(value, inUser, seen) {
    if (typeof value === 'string') return scrubString(value);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '<circular>';
    seen.add(value);
    if (value instanceof Error) {
      const out = { name: value.name, message: scrubString(value.message) };
      if (value.cause !== undefined) out.cause = walk(value.cause, false, seen);
      return out;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, inUser, seen));
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (DROPPED_KEYS.has(key)) continue;
      if (inUser && USER_FIELDS.includes(key)) continue;
      out[key] = walk(child, USER_KEYS.has(key), seen);
    }
    return out;
  }

  return (value) => walk(value, false, new WeakSet());
}

export function filterHeaders(headers) {
  const out = {};
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (HEADER_ALLOWLIST.some((pattern) => pattern.test(lower))) out[lower] = value;
  }
  return out;
}
