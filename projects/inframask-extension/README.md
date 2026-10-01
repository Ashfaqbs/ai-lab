# InfraMask

## Overview

InfraMask is a Chrome extension (Manifest V3) that detects sensitive values as a
developer types into an AI chat UI (ChatGPT, Claude.ai, Gemini) and masks them before
the message is sent, then automatically restores those values in the assistant's
response for on-screen display only. It is an implementation of the design in
[`designs/inframask`](../../designs/inframask/README.md), extended to cover the case
that actually motivated it: developers on a team with sanctioned AI tool access
pasting usernames, passwords, API keys, and Kafka bootstrap servers straight into a
browser chat window, with no way to stop it short of removing the tool entirely.

The original design scoped out credentials as a v2 "generic PII" concern and focused
on infra identifiers (IPs, hostnames, bootstrap servers). This implementation folds
credential detection into v1, because in practice the two travel together: a
bootstrap server string is rarely pasted without the SASL username/password next to
it.

## What it detects

Each detector is a pure function (`text -> matches`), independently unit-tested, with
no DOM dependency. Overlapping matches resolve longest-match-wins, so a password
embedded in a connection string is masked once as a connection string, not twice.

| Type | Example |
|---|---|
| `private_key` | `-----BEGIN RSA PRIVATE KEY-----...` |
| `jwt` | `eyJhbGc...payload...sig` |
| `conn_string` | `postgres://admin:s3cret@db.internal.corp:5432/app` |
| `bootstrap_servers` | `broker1:9092,broker2:9092,broker3:9092` |
| `aws_access_key` | `AKIAIOSFODNN7EXAMPLE` |
| `api_key` | OpenAI `sk-...`, GitHub `ghp_...`, Slack `xox...`, Google `AIza...` |
| `bearer_token` | `Bearer eyJ...` |
| `credential_kv` | `password=`, `pwd=`, `secret=`, `token=`, `username=` assignments |
| `host_port` | `10.4.12.9:5432` |
| `url` | any `scheme://...` string |
| `hostname` | `broker-3.kafka.internal.corp` |
| `ipv6` / `ipv4` | `10.4.12.9`, `fe80::1ff:fe23:4567:890a` |

## How it works

1. A content script injected only on `chatgpt.com`, `claude.ai`, and
   `gemini.google.com` attaches to the site's chat input box (per-site selectors live
   in `src/site-adapters.js`).
2. On a debounced `input` event, the Masking Engine (`src/masking-engine.js`) scans
   the box's current text, finds new matches via the Detectors (`src/detectors.js`),
   and rewrites each one in place to a token like `⟦CRED_1⟧`, preserving cursor
   position.
3. The real value is stored only in an in-memory Token Store
   (`src/token-store.js`), mirrored best-effort into `chrome.storage.session` so the
   popup can show the live token map. Nothing is written to disk or synced.
4. The user sends the message as normal — the AI provider only ever receives the
   masked text.
5. A `MutationObserver` watches the assistant's response container. When the
   response references a token, it is swapped back to the real value for display
   only; nothing is re-sent.
6. Closing the tab clears everything.

## Project structure

```
manifest.json          Manifest V3 config, content script matches
src/
  detectors.js          Pure detection functions (no DOM) - the part that matters
  token-store.js         In-memory + chrome.storage.session mirror
  masking-engine.js      maskText() / unmaskText(), wraps detectors + token store
  site-adapters.js       Per-site selectors (ChatGPT, Claude, Gemini)
  content-script.js      DOM wiring: debounce, cursor preservation, MutationObserver
  background.js          Badge count, enabled/disabled flag - sees no message content
  popup.html / popup.js  Toggle + live token map for the active tab
icons/                  Generated via scripts/make-icons.js (placeholder red icon)
tests/
  detectors.test.js      Unit tests for every detector + overlap resolution
  masking-engine.test.js Round-trip mask -> unmask tests
```

## How to run

Load unpacked, no build step required:

1. `chrome://extensions` -> enable Developer mode -> "Load unpacked" -> select this
   folder.
2. Open `chatgpt.com`, `claude.ai`, or `gemini.google.com`, type a sensitive value
   (e.g. `password=hunter2` or `broker1:9092,broker2:9092`) into the chat box, and
   confirm it is replaced with a `⟦...⟧` token before you hit send.
3. Click the toolbar icon to see the live token map for the active tab, toggle
   masking on/off, or clear the current tab's tokens.

Run the detector/engine unit tests (Node's built-in test runner, no dependencies):

```
npm test
```

## Known limitations

- Rewriting a React/ProseMirror-controlled `contentEditable` (ChatGPT, Claude) must go
  through `document.execCommand('insertText', ...)`, not a direct `el.textContent =`
  write. These editors keep their own internal document model separate from the DOM;
  a direct textContent write changes what's displayed but never reaches that model, so
  the framework still submits the original, unmasked text even though the screen shows
  a token. `execCommand` fires the native `beforeinput`/`input` events the editor
  listens to, which updates its internal state to match. Verified live against
  chatgpt.com: a raw `textContent` clear left the send button's `aria-disabled`
  unchanged (stale state), while an `execCommand`-based clear correctly swapped the
  send button out for the empty-input mic icon (state in sync with the DOM).
- Selectors in `site-adapters.js` are best-effort against each site's current DOM.
  ChatGPT, Claude, and Gemini all change their markup periodically; if masking stops
  triggering on a site, that selector is the first thing to check.
- Masking is content-script-only (visible, in-place DOM rewriting), not a network-layer
  interceptor — matches InfraMask's original design decision (Section 10, alternative
  C) to keep masking transparent and editable rather than invisible.
- `credential_kv` is a keyword + value heuristic (`password=`, `token:`, etc.), not a
  secret-strength classifier — it will not catch a bare secret with no labeling key
  next to it, and a keyword immediately followed by a JWT or API key gets classified
  as `credential_kv` rather than `jwt`/`api_key` (longest-match-wins picks the match
  that includes the label). Both still get masked; only the reported *type* differs.
- No PII detectors (names, emails, SSNs, card numbers) — still a deliberate v1
  non-goal per the original design, not an oversight.
- Not yet published to the Chrome Web Store; "Load unpacked" only.
