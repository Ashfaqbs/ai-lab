// Masking Engine: scans text for sensitive matches and rewrites them to tokens in place.
// Pure with respect to the DOM — takes a string, a TokenStore, returns a new string.
// DOM/cursor handling lives in content-script.js, which calls this.

const { detectAll } = typeof require !== 'undefined' ? require('./detectors') : window.InfraMaskDetectors;

const TOKEN_PATTERN = /⟦[A-Z]+_\d+⟧/g; // ⟦LABEL_n⟧

function isAlreadyToken(value) {
  return value.includes('⟦') || value.includes('⟧');
}

/**
 * Masks newly-typed sensitive values in `text`, reusing existing tokens for values the
 * TokenStore has already seen this session. Does not touch text that is already a token.
 */
function maskText(text, tokenStore) {
  const matches = detectAll(text).filter((m) => !isAlreadyToken(m.value));
  if (matches.length === 0) return { text, changed: false, maskedCount: 0 };

  let result = text;
  // Replace right-to-left so earlier match indices stay valid.
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const token = tokenStore.tokenFor(m.type, m.value);
    result = result.slice(0, m.start) + token + result.slice(m.end);
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
