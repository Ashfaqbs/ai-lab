const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, DEFAULT_SETTINGS } = require('../src/settings');

test('normalize returns the defaults when given nothing', () => {
  const result = normalize(null);
  assert.deepEqual(result, DEFAULT_SETTINGS);
});

test('normalize fills in a missing category as enabled rather than undefined', () => {
  const result = normalize({ enabled: true, categories: { pii: false } });
  assert.equal(result.categories.pii, false);
  assert.equal(result.categories.credentials, true);
  assert.equal(result.categories.infra, true);
});

test('normalize keeps an explicit enabled: false', () => {
  const result = normalize({ enabled: false, categories: {} });
  assert.equal(result.enabled, false);
});

test('normalize does not mutate DEFAULT_SETTINGS', () => {
  const result = normalize({ categories: { pii: false } });
  result.categories.pii = true;
  assert.equal(DEFAULT_SETTINGS.categories.pii, true);
});
