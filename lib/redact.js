/**
 * Hides secrets in text that will be shown to a person or written to a log.
 *
 * @param {string} text
 * @param {Array<string | undefined | null>} secrets exact values to hide, such as the API token
 * @returns {string}
 */
export function redact(text, secrets = []) {
  let result = text;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('***');
  }
  // A username or password inside a URL, such as http://user:pw@proxy:3128.
  return result.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');
}
