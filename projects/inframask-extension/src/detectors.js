// Pure detector functions: text -> [{ type, start, end, value }]
// No DOM dependency, so these are unit-testable in plain Node.
//
// Guarded against double-injection: an unpacked extension reload re-runs content scripts
// in tabs that were already open, without clearing previous top-level declarations. Without
// this guard, a second injection throws "Identifier has already been declared" and the whole
// file (and everything after it) silently fails to load.
if (typeof window !== 'undefined' && window.InfraMaskDetectors) {
  // already loaded in this page - skip re-declaring
} else {
(function () {
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

const IPV6 = /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}(?:%[a-zA-Z0-9]+)?\b/g;

// Internal-looking hostname/FQDN: at least one dot, plausible labels, not a bare number/version.
const HOSTNAME = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:internal|corp|local|svc|cluster\.local|[a-zA-Z]{2,})\b/g;

// host:port pair (single)
const HOST_PORT = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?:\d{2,5}\b/g;

// Kafka-style bootstrap server list: 2+ host:port pairs comma-separated
const BOOTSTRAP_SERVERS = /\b(?:[a-zA-Z0-9][a-zA-Z0-9.-]*:\d{2,5})(?:\s*,\s*[a-zA-Z0-9][a-zA-Z0-9.-]*:\d{2,5}){1,}\b/g;

// scheme://[user[:pass]@]host[:port][/path]
const URL_PATTERN = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^\s@/]+@)?[^\s"'<>]+/g;

// scheme://user:pass@host (DB connection strings, basic-auth URLs)
const CONN_STRING_WITH_CREDS = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|ftp|sftp|https?):\/\/[^\s:@/]+:[^\s:@/]+@[^\s"'<>]+/g;

// KEY=VALUE / KEY: VALUE credential assignments (password, secret, token, apikey, username, user)
// Carries the 'd' flag so group indices are available - this detector masks only the VALUE
// half, keeping the key literal (e.g. "password=⟦CRED_1⟧"), so the masked text still shows
// what kind of secret was there without revealing it.
const CREDENTIAL_KV = /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token|auth|username|user(?:name)?)\s*[:=]\s*["']?([^\s"'&,;]{3,})["']?/gid;

// AWS access key id
const AWS_ACCESS_KEY = /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g;

// Common prefixed API key / token formats (OpenAI, GitHub, Slack, generic bearer)
const PREFIXED_API_KEY = /\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/g;

const BEARER_TOKEN = /\bBearer\s+[a-zA-Z0-9\-._~+/]+=*/g;

// JWT: header.payload.signature, each base64url
const JWT = /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;

const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g;

function runGlobal(regex, text, type) {
  const matches = [];
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    // By default the whole match is what gets masked (there's no "key" to keep literal).
    matches.push({ type, start, end, value: m[0], maskStart: start, maskEnd: end, maskValue: m[0] });
    if (m[0].length === 0) regex.lastIndex++;
  }
  return matches;
}

// credential_kv masks only the value half of a "key=value"/"key: value" pair, keeping the
// key literal so the masked text stays traceable (e.g. "password=⟦CRED_1⟧", not an opaque
// "⟦CRED_1⟧" that hides which field it was). Needs the regex's 'd' flag for group indices.
function runCredentialKV(regex, text) {
  const matches = [];
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(text)) !== null) {
    const [start, end] = m.indices[0];
    const [valueStart, valueEnd] = m.indices[2];
    matches.push({
      type: 'credential_kv',
      start,
      end,
      value: m[0],
      maskStart: valueStart,
      maskEnd: valueEnd,
      maskValue: m[2],
    });
    if (m[0].length === 0) regex.lastIndex++;
  }
  return matches;
}

// Detectors in priority order, most specific/highest-value first.
// Order matters for tie-breaking when two matches have identical length.
const DETECTOR_ORDER = [
  ['private_key', PRIVATE_KEY_BLOCK],
  ['jwt', JWT],
  ['conn_string', CONN_STRING_WITH_CREDS],
  ['bootstrap_servers', BOOTSTRAP_SERVERS],
  ['aws_access_key', AWS_ACCESS_KEY],
  ['api_key', PREFIXED_API_KEY],
  ['bearer_token', BEARER_TOKEN],
  ['credential_kv', CREDENTIAL_KV],
  ['host_port', HOST_PORT],
  ['url', URL_PATTERN],
  ['hostname', HOSTNAME],
  ['ipv6', IPV6],
  ['ipv4', IPV4],
];

/**
 * Runs every detector and resolves overlaps with longest-match-wins.
 * On equal length, the earlier entry in DETECTOR_ORDER wins (it is more specific).
 */
function detectAll(text) {
  const all = [];
  DETECTOR_ORDER.forEach(([type, regex], priority) => {
    const matches = type === 'credential_kv' ? runCredentialKV(regex, text) : runGlobal(regex, text, type);
    matches.forEach((match) => all.push({ ...match, priority }));
  });

  // Longest match wins; on a tie, the more specific detector (lower priority index) wins.
  const byLengthThenPriority = [...all].sort(
    (a, b) => (b.end - b.start) - (a.end - a.start) || a.priority - b.priority
  );

  const resolved = [];
  const taken = []; // [start, end) spans already claimed, in resolved order

  for (const match of byLengthThenPriority) {
    const overlaps = taken.some(([s, e]) => match.start < e && match.end > s);
    if (!overlaps) {
      resolved.push(match);
      taken.push([match.start, match.end]);
    }
  }

  resolved.sort((a, b) => a.start - b.start);
  return resolved.map(({ type, start, end, value, maskStart, maskEnd, maskValue }) => ({
    type,
    start,
    end,
    value,
    maskStart,
    maskEnd,
    maskValue,
  }));
}

const api = {
  detectAll,
  DETECTOR_ORDER,
  patterns: {
    IPV4,
    IPV6,
    HOSTNAME,
    HOST_PORT,
    BOOTSTRAP_SERVERS,
    URL_PATTERN,
    CONN_STRING_WITH_CREDS,
    CREDENTIAL_KV,
    AWS_ACCESS_KEY,
    PREFIXED_API_KEY,
    BEARER_TOKEN,
    JWT,
    PRIVATE_KEY_BLOCK,
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.InfraMaskDetectors = api;
}
})();
}
