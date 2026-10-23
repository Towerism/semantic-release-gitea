/**
 * Entry point of the semantic-release plugin. semantic-release calls these
 * five functions at fixed steps of a release. Each one rejects until the issue
 * that implements it lands.
 */

/**
 * @param {string} step
 * @returns {Promise<never>}
 */
async function notImplemented(step) {
  throw new Error(`semantic-release-gitea: ${step} is not implemented yet`);
}

/**
 * @param {object} _pluginConfig
 * @param {object} _context
 * @returns {Promise<void>}
 */
export async function verifyConditions(_pluginConfig, _context) {
  return notImplemented('verifyConditions');
}

/**
 * @param {object} _pluginConfig
 * @param {object} _context
 * @returns {Promise<unknown>}
 */
export async function publish(_pluginConfig, _context) {
  return notImplemented('publish');
}

/**
 * @param {object} _pluginConfig
 * @param {object} _context
 * @returns {Promise<unknown>}
 */
export async function addChannel(_pluginConfig, _context) {
  return notImplemented('addChannel');
}

/**
 * @param {object} _pluginConfig
 * @param {object} _context
 * @returns {Promise<void>}
 */
export async function success(_pluginConfig, _context) {
  return notImplemented('success');
}

/**
 * @param {object} _pluginConfig
 * @param {object} _context
 * @returns {Promise<void>}
 */
export async function fail(_pluginConfig, _context) {
  return notImplemented('fail');
}
