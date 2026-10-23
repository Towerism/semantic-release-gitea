import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionPasses } from '../lib/condition.js';

test('an empty result, the text false in any padding, and a false boolean do not pass', () => {
  for (const rendered of ['', '   ', 'false', ' false\n', false, undefined, null, 0]) {
    assert.equal(conditionPasses(rendered), false, `${JSON.stringify(rendered)} should not pass`);
  }
});

test('any other text, true and other truthy values pass', () => {
  for (const rendered of ['true', 'yes', '0', 'False positive', true, 1, {}]) {
    assert.equal(conditionPasses(rendered), true, `${JSON.stringify(rendered)} should pass`);
  }
});
