const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskText, unmaskText } = require('../src/masking-engine');
const { createTokenStore } = require('../src/token-store');

test('masks a password and restores it via unmaskText (round trip)', () => {
  const store = createTokenStore();
  const original = 'connect with password=hunter2 to the server';
  const { text: masked, changed } = maskText(original, store);

  assert.equal(changed, true);
  assert.equal(masked.includes('hunter2'), false);
  assert.match(masked, /⟦CRED_1⟧/);

  const restored = unmaskText(masked, store);
  assert.equal(restored, original);
});

test('reuses the same token for a repeated value', () => {
  const store = createTokenStore();
  const { text } = maskText('broker1:9092,broker2:9092,broker3:9092 then again broker1:9092,broker2:9092,broker3:9092', store);
  const tokens = text.match(/⟦BOOTSTRAP_\d+⟧/g);
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0], tokens[1]);
});

test('does not re-mask text that is already a token', () => {
  const store = createTokenStore();
  const first = maskText('ip is 10.1.2.3', store).text;
  const second = maskText(first, store);
  assert.equal(second.changed, false);
  assert.equal(second.text, first);
});

test('unmaskText leaves unknown tokens untouched', () => {
  const store = createTokenStore();
  const result = unmaskText('value is ⟦IP_99⟧ unknown', store);
  assert.equal(result, 'value is ⟦IP_99⟧ unknown');
});

test('credential_kv masking keeps the key literal and only tokenizes the value', () => {
  const store = createTokenStore();
  const { text } = maskText('password=hunter2', store);
  assert.equal(text, 'password=⟦CRED_1⟧');
  assert.equal(unmaskText(text, store), 'password=hunter2');
});

test('credential_kv masking is traceable for multiple distinct keys', () => {
  const store = createTokenStore();
  const { text } = maskText('username=jdoe password=hunter2', store);
  assert.equal(text, 'username=⟦CRED_1⟧ password=⟦CRED_2⟧');
});
