const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectAll } = require('../src/detectors');

function typesOf(text) {
  return detectAll(text).map((m) => m.type);
}

test('detects a plain IPv4 address', () => {
  const matches = detectAll('connect to 10.4.12.9 please');
  assert.deepEqual(matches.map((m) => m.value), ['10.4.12.9']);
  assert.equal(matches[0].type, 'ipv4');
});

test('detects a Kafka bootstrap server list as one unit, not three hosts', () => {
  const matches = detectAll('brokers: broker1:9092,broker2:9092,broker3:9092');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, 'bootstrap_servers');
  assert.equal(matches[0].value, 'broker1:9092,broker2:9092,broker3:9092');
});

test('detects password= assignment', () => {
  const matches = detectAll('db password=SuperSecret123 now connect');
  assert.equal(matches.some((m) => m.type === 'credential_kv'), true);
  const m = matches.find((m) => m.type === 'credential_kv');
  assert.match(m.value, /^password\s*=\s*SuperSecret123$/);
});

test('detects username= and password= as two separate credential_kv matches', () => {
  const matches = detectAll('username=jdoe password=hunter2');
  const types = matches.filter((m) => m.type === 'credential_kv');
  assert.equal(types.length, 2);
});

test('detects a Postgres connection string with embedded credentials as one unit', () => {
  const matches = detectAll('conn: postgres://admin:s3cret@db.internal.corp:5432/app');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, 'conn_string');
});

test('detects an AWS access key id', () => {
  const matches = detectAll('key AKIAIOSFODNN7EXAMPLE is leaked');
  assert.equal(matches[0].type, 'aws_access_key');
});

test('detects an OpenAI-style API key', () => {
  const matches = detectAll('use sk-abcdefghijklmnopqrstuvwxyz0123456789 for auth');
  assert.equal(matches.some((m) => m.type === 'api_key'), true);
});

test('detects a JWT', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const matches = detectAll(`the session value is ${jwt}`);
  assert.equal(matches[0].type, 'jwt');
  assert.equal(matches[0].value, jwt);
});

test('detects a PEM private key block as one unit', () => {
  const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...\n-----END RSA PRIVATE KEY-----';
  const matches = detectAll(`here is my key:\n${key}`);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, 'private_key');
});

test('detects an internal hostname', () => {
  const matches = detectAll('ssh into broker-3.kafka.internal.corp now');
  assert.equal(matches.some((m) => m.type === 'hostname'), true);
});

test('does not re-mask an already-masked token', () => {
  const matches = detectAll('value is ⟦IP_1⟧ already masked');
  assert.equal(matches.length, 0);
});

test('bootstrap_servers wins over individual host_port matches (longest-match-wins)', () => {
  const types = typesOf('broker1:9092,broker2:9092');
  assert.deepEqual(types, ['bootstrap_servers']);
});

test('connection string with credentials is not double-counted as url + credential_kv', () => {
  const matches = detectAll('mongodb://svc_user:p@ssw0rd@cluster0.internal.corp:27017/mydb');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, 'conn_string');
});

test('ignores ordinary prose with no sensitive values', () => {
  const matches = detectAll('please review the pull request and leave comments');
  assert.equal(matches.length, 0);
});

test('version numbers are not falsely flagged as IPv4', () => {
  // version-like strings with 2 segments should not match the 4-octet IPv4 pattern
  const matches = detectAll('upgrade to v2.1 of the library');
  assert.equal(matches.some((m) => m.type === 'ipv4'), false);
});
