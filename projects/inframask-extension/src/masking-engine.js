// Masking Engine: scans text for sensitive matches and rewrites them to tokens in place.
// Pure with respect to the DOM — takes a string, a TokenStore, returns a new string.
// DOM/cursor handling lives in content-script.js, which calls this.

if (typeof window !== 'undefined' && window.InfraMaskEngine) {
  // already loaded in this page - skip re-declaring
} else {
(function () {
const { detectAll } = typeof require !== 'undefined' ? require('./detectors') : window.InfraMaskDetectors;

const TOKEN_PATTERN = /⟦[A-Z]+_\d+⟧/g; // ⟦LABEL_n⟧

function isAlreadyToken(value) {
  return value.includes('⟦') || value.includes('⟧');
}

/**
 * Masks newly-typed sensitive values in `text`, reusing existing tokens for values the
 * TokenStore has already seen this session. Does not touch text that is already a token.
 *
 * Only the maskStart..maskEnd sub-range of each match is replaced, not the whole match -
 * for a key=value pair (credential_kv) that's just the value, so "password=hunter2" becomes
 * "password=⟦CRED_1⟧" rather than an opaque "⟦CRED_1⟧" that hides which field it was. Other
 * detector types have no separate key, so their mask range is the whole match.
 *
 * `options.categories` (see src/detectors.js) lets a category be skipped entirely, both so
 * the extension's options page can turn off PII/infra/credential detection independently,
 * and so a disabled category's regexes never even run - no point paying for detectors the
 * user doesn't want.
 */
function maskText(text, tokenStore, options = {}) {
  const matches = detectAll(text, options).filter((m) => !isAlreadyToken(m.value));
  if (matches.length === 0) return { text, changed: false, maskedCount: 0 };

  // detectAll returns matches sorted left-to-right. Assign/reuse tokens in that reading
  // order first, so numbering (CRED_1, CRED_2, ...) follows the order secrets appear in
  // the text - then substitute right-to-left so earlier match indices stay valid.
  const tokens = matches.map((m) => tokenStore.tokenFor(m.type, m.maskValue));

  let result = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    result = result.slice(0, m.maskStart) + tokens[i] + result.slice(m.maskEnd);
  }

  return { text: result, changed: result !== text, maskedCount: matches.length };
}

/**
 * Replaces every token found in `text` with its real value from the TokenStore, for
 * display only. Unknown tokens (not in this session's store) are left as-is.
 */
function unmaskText(text, tokenStore) {
  return text.replace(TOKEN_PATTERN, (token) => {
    const real = tokenStore.realValueFor(token);
    return real === undefined ? token : real;
  });
}

const api = { maskText, unmaskText, TOKEN_PATTERN };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.InfraMaskEngine = api;
}
})();
}
