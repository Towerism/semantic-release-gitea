import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { isPlainObject, template } from 'lodash-es';
import { glob } from 'tinyglobby';

/**
 * @typedef {string | string[] | { path: string | string[], name?: string, label?: string }} AssetDefinition
 * @typedef {{ path: string, name: string }} Asset a readable file and the name to upload it under
 */

/**
 * Finds the files for the `assets` option and checks each one, so that
 * everything that can fail without the server fails before a release exists.
 *
 * The rules follow the GitHub plugin. A string is a glob, an array is a group
 * of globs where a `!` pattern removes files, and an object has a `path` and
 * an optional `name`. A glob that matches nothing is kept as a plain path, so
 * the missing file is reported instead of dropped. Objects win over strings
 * when both name the same file.
 *
 * A path that cannot be read, or is not a regular file, is logged as an error
 * and left out. A `label` is logged as ignored, because Gitea assets have none.
 *
 * @param {import('../index.js').Context} context
 * @param {AssetDefinition[]} assets
 * @returns {Promise<Asset[]>}
 */
export async function prepareAssets(context, assets) {
  const cwd = context.cwd ?? process.cwd();
  const { logger } = context;

  const found = (await Promise.all(assets.map((asset) => expand(cwd, asset)))).flat();
  // Objects first, so one that names a file beats a plain string for the same file.
  const ordered = [...found.filter(isPlainObject), ...found.filter((asset) => !isPlainObject(asset))];
  const unique = ordered.filter((asset, index) => ordered.findIndex((other) => resolve(cwd, pathOf(other)) === resolve(cwd, pathOf(asset))) === index);

  /** @type {Asset[]} */
  const readable = [];
  for (const asset of unique) {
    const filePath = pathOf(asset);
    const resolved = resolve(cwd, filePath);
    /** @type {import('node:fs').Stats | undefined} */
    let file;
    try {
      file = await stat(resolved);
    } catch {
      logger.error('The asset %s cannot be read, and will be ignored.', filePath);
      continue;
    }
    if (!file.isFile()) {
      logger.error('The asset %s is not a file, and will be ignored.', resolved);
      continue;
    }
    const object = isPlainObject(asset) ? /** @type {Exclude<AssetDefinition, string | string[]>} */ (asset) : undefined;
    if (object?.label) logger.warn('The label of asset %s is ignored, because Gitea release assets have no label.', filePath);
    const name = object?.name ? template(object.name)(context) : basename(filePath);
    readable.push({ path: resolved, name });
  }
  return readable;
}

/** @param {unknown} asset @returns {string} */
const pathOf = (asset) => (isPlainObject(asset) ? /** @type {{ path: string }} */ (asset).path : /** @type {string} */ (asset));

/**
 * One definition to the files it names.
 * @param {string} cwd
 * @param {AssetDefinition} asset
 * @returns {Promise<Array<string | { path: string, name?: string, label?: string }>>}
 */
async function expand(cwd, asset) {
  const object = isPlainObject(asset) ? /** @type {{ path: string | string[], name?: string, label?: string }} */ (asset) : undefined;
  const patterns = /** @type {string[]} */ ([object ? object.path : asset].flat());

  // A lone `!pattern` would otherwise match nearly every file in the project.
  if (patterns.length <= 1 && patterns[0].startsWith('!')) return [];

  const matched = await glob(patterns, { cwd, expandDirectories: true, dot: true, onlyFiles: false });

  if (object) {
    // Several matches: the object's name cannot apply to all of them, so each file keeps its own.
    if (matched.length > 1) return matched.map((file) => ({ ...object, path: file, name: basename(file) }));
    return [{ ...object, path: matched[0] ?? patterns[0] }];
  }
  return matched.length > 0 ? matched : patterns;
}
