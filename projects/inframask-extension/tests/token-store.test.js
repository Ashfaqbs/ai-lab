const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTokenStore } = require('../src/token-store');

test('reuses the same token for a value seen twice', () => {
  const store = createTokenStore();
  const first = store.tokenFor('ipv4', '10.1.2.3');
  const second = store.tokenFor('ipv4', '10.1.2.3');
  assert.equal(first, second);
  assert.equal(store.entries().length, 1);
});

test('clear() empties the map', () => {
  const store = createTokenStore();
  store.tokenFor('ipv4', '10.1.2.3');
  store.clear();
  assert.equal(store.entries().length, 0);
  assert.equal(store.realValueFor('⟦IP_1⟧'), undefined);
});

test('evicts the oldest entry once the store exceeds its cap, so a long-lived tab does not grow unbounded', () => {
  const store = createTokenStore();
  const CAP = 2000; // keep in sync with MAX_TOKENS in src/token-store.js
  for (let i = 0; i < CAP; i++) {
    store.tokenFor('ipv4', `value-${i}`);
  }
  assert.equal(store.entries().length, CAP);

  const firstToken = store.tokenFor('ipv4', 'value-0');
  store.tokenFor('ipv4', 'value-overflow');

  // the store never exceeds its cap...
  assert.equal(store.entries().length, CAP);
  // ...because the oldest entry (value-0) was dropped to make room for the new one.
  assert.equal(store.realValueFor(firstToken), undefined);
});
