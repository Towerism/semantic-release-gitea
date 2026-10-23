/**
 * Decides whether a rendered condition template lets an item through.
 *
 * A lodash template returns text, so `<%= false %>` renders the word "false",
 * which is truthy in JavaScript. An empty result and the word "false" both
 * count as no, so that form works as well as `<% return false %>`.
 *
 * @param {unknown} rendered
 * @returns {boolean}
 */
export function conditionPasses(rendered) {
  if (typeof rendered === 'string') {
    const text = rendered.trim();
    return text !== '' && text !== 'false';
  }
  return Boolean(rendered);
}
