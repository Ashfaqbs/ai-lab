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
it. It further extends v1 to cover common retail/customer-facing sensitive data
(emails, phone numbers, SSNs, credit card numbers) behind its own toggle, so teams
outside pure infra/platform work - e.g. retail, support, anyone handling customer
records - get the same protection without infra-specific assumptions.

## What it detects

Each detector is a pure function (`text -> matches`), independently unit-tested, with
no DOM dependency. Overlapping matches resolve longest-match-wins, so a password
embedded in a connection string is masked once as a connection string, not twice.

`credential_kv` masks only the *value* half of a `key=value`/`key: value` pair, keeping
the key literal: `password=hunter2` becomes `password=⟦CRED_1⟧`, not an opaque
`⟦CRED_1⟧` that hides which field it was. This keeps the masked text traceable - you
can tell it was a password, a username, or a token at a glance, without ever seeing
the real value. Every other detector type (bootstrap servers, connection strings, API
keys, etc.) masks the whole match, since there's no separate "key" to preserve and the
hostname/endpoint itself is usually what needs hiding.

| Type | Category | Example |
|---|---|---|
| `private_key` | Credentials | `-----BEGIN RSA PRIVATE KEY-----...` |
| `jwt` | Credentials | `eyJhbGc...payload...sig` |
| `conn_string` | Credentials | `postgres://admin:s3cret@db.internal.corp:5432/app` |
| `aws_access_key` | Credentials | `AKIAIOSFODNN7EXAMPLE` |
| `api_key` | Credentials | OpenAI `sk-...`, GitHub `ghp_...`, Slack `xox...`, Google `AIza...` |
| `bearer_token` | Credentials | `Bearer eyJ...` |
| `credential_kv` | Credentials | `password=`, `pwd=`, `secret=`, `token=`, `username=` assignments |
| `bootstrap_servers` | Infra | `broker1:9092,broker2:9092,broker3:9092` |
| `host_port` | Infra | `10.4.12.9:5432` |
| `url` | Infra | any `scheme://...` string |
| `hostname` | Infra | `broker-3.kafka.internal.corp` |
| `ipv6` / `ipv4` | Infra | `10.4.12.9`, `fe80::1ff:fe23:4567:890a` |
| `credit_card` | PII | `4111111111111111` (Luhn-checksum validated, not just digit-counted) |
| `ssn` | PII | `123-45-6789` |
| `email` | PII | `jane.doe@example.com` |
| `phone` | PII | `(415) 555-0132`, `+1 415-555-0132` |

Each category (Credentials, Infra, PII) can be turned on or off independently from the
extension's **Options** page (right-click the toolbar icon -> Options, or the "Options"
button in the popup) - see [Options & settings](#options--settings) below.

## How it works

1. A content script injected only on `chatgpt.com`, `claude.ai`, and
   `gemini.google.com` attaches to the site's chat input box (per-site selectors live
   in `src/site-adapters.js`). It does **not** touch the box's content while the user
   is typing or editing - see "Why masking happens at submit time, not as you type"
   below for why.
2. When the user actually submits - Enter or the site's Send button -
   `content-script.js` intercepts that action first, synchronously runs the Masking
   Engine (`src/masking-engine.js`) over the box's current text, finds matches via the
   Detectors (`src/detectors.js`), and rewrites each one in place to a token like
   `⟦CRED_1⟧` - then re-triggers the real send. The real send only ever fires with
   what's in the box *after* masking, never before.
3. The real value is stored only in an in-memory Token Store
   (`src/token-store.js`), mirrored best-effort into `chrome.storage.session` so the
   popup can show the live token map. Nothing is written to disk or synced.
4. The AI provider only ever receives the masked text.
5. A `MutationObserver` watches the assistant's response container. When the
   response references a token, it is swapped back to the real value for display
   only; nothing is re-sent.
6. Closing the tab clears everything.

### Why masking happens at submit time, not as you type

An earlier version masked continuously, on a debounced `input` event, as the user
typed or pasted. Two concrete, live-verified problems with that approach led to
replacing it with the submit-time interception described above:

1. **A race condition.** Type a secret and hit Enter, or paste and immediately click
   Send, faster than the debounce window, and the *original* unmasked text could go
   out before a mask pass ever ran. Shortening the debounce only made this rarer, not
   impossible.
2. **It corrupted multi-line pastes and broke further editing.** Verified live against
   chatgpt.com: `el.textContent` on its contentEditable input silently drops *all* line
   breaks between paragraphs - a 3-line paste reads back as one run-on string with zero
   separation. Every live mask pass was reading that flattened text and writing it back,
   which collapsed multi-line pasted content (a pasted YAML block or `.properties` file,
   exactly the case this tool is meant to handle) into a single unreadable block, and
   left the editor's internal paragraph structure corrupted enough that further edits
   stopped landing correctly in the pasted area.

Masking once, synchronously, at the moment of submission avoids both: there's no window
between "masked" and "sent" for a race to exist in, and the DOM is never rewritten while
the user is still actively editing, so there's nothing to corrupt. This also matches how
a similar tool at a previous employer behaved (mask only at submit), which is what
surfaced the comparison in the first place.

The interception itself runs in the capture phase at the document root, which fires
before the page's own framework-level handlers ever see the event, regardless of where
the framework attaches its own handling (the same mechanism behind the earlier
ProseMirror write-back fix). On interception it: cancels the native event, forces an
immediate mask pass, then re-triggers the real send - preferring a click on the site's
actual Send button, falling back to re-dispatching a native Enter keydown if the button
selector doesn't match.

**What was verified live, and what wasn't:** the Enter-interception mechanism itself was
verified end-to-end against chatgpt.com (typed `password=hunter2` character-by-character,
sent Enter as an immediate discrete keypress - the box held the masked token before any
submission could occur, with nothing actually sent). The multi-line read/write-back fix
(`el.innerText`, normalized, instead of `el.textContent`) was verified in isolation
against the same live editor - confirmed a 3-paragraph structure round-trips correctly
when read via `innerText` and written back with single `\n` separators. The two were not
re-verified together end-to-end on a full multi-line paste through the real extension,
because ChatGPT's account-level draft sync (it persists and restores unsent composer
text across page loads) kept reintroducing a stale masked draft from earlier testing,
independent of what the extension's own code did - repeated automated testing on a real
account polluted its own test conditions. Each piece is independently confirmed correct;
testing them together on your end (paste a multi-line block, confirm it's still editable,
then send) is the one step that would close that last gap.

## Options & settings

Everything is controlled from one place: the **Options** page (`src/options.html`,
reachable from the popup's "Options" button, or right-click the toolbar icon ->
Options). It persists to `chrome.storage.local` under a single `inframaskSettings`
key, shared by the content script, popup, and background worker via `src/settings.js`
so the storage shape only lives in one place.

- **Masking enabled** - the master on/off switch (same toggle as the popup's).
- **Credentials & secrets**, **Infrastructure identifiers**, **PII & retail-sensitive
  data** - each category can be disabled independently. A disabled category's
  detectors don't just get filtered out afterward - they never run at all for that
  pass (see `detectAll(text, { categories })` in `src/detectors.js`), so turning off
  PII scanning on a pure-infra team's machine also saves the matching work, not just
  the masking.
- Settings changes apply live to every open matching tab via
  `chrome.storage.onChanged` - no reload needed.

## Project structure

```
manifest.json            Manifest V3 config, content script matches, options_page
src/
  settings.js             Settings shape, defaults, load/save - shared by every other file
  detectors.js             Pure detection functions (no DOM), tagged by category
  token-store.js           In-memory + chrome.storage.session mirror
  masking-engine.js        maskText() / unmaskText(), wraps detectors + token store
  site-adapters.js         Per-site selectors (ChatGPT, Claude, Gemini)
  content-script.js        DOM wiring: submit-time interception, MutationObserver
  background.js            Badge count, default settings on install - sees no message content
  popup.html / popup.js    Quick toggle + live token map for the active tab
  options.html / options.js Full settings page: master switch + per-category toggles
icons/                    Generated via scripts/make-icons.js (padlock icon, no deps)
tests/
  detectors.test.js        Unit tests for every detector, overlap resolution, categories
  masking-engine.test.js   Round-trip mask -> unmask tests
  settings.test.js         normalize()/defaults tests
```

## How to run

Load unpacked, no build step required:

1. `chrome://extensions` -> enable Developer mode -> "Load unpacked" -> select this
   folder.
2. Open `chatgpt.com`, `claude.ai`, or `gemini.google.com`, type a sensitive value
   (e.g. `password=hunter2` or `broker1:9092,broker2:9092`) into the chat box, and
   confirm it is replaced with a `⟦...⟧` token before you hit send.
3. Click the toolbar icon to see the live token map for the active tab, toggle
   masking on/off, or clear the current tab's tokens. Click "Options" for the full
   settings page (per-category toggles).

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
  triggering on a site, that selector is the first thing to check. `sendButtonSelector`
  is only live-verified for ChatGPT; Claude's and Gemini's are best-effort guesses. If
  one goes stale, Enter is still caught (so masking still happens before any submit),
  but the fallback re-dispatches a synthetic Enter keydown instead of clicking the real
  button, which is slightly less reliable across frameworks.
- The Enter/Send interception only recognizes plain `Enter` (no modifier) as a submit
  trigger, matching how all three sites behave by default. A site-level setting that
  remaps sending to `Ctrl+Enter`/`Cmd+Enter` instead would not be caught - there's no
  other masking trigger to fall back on, so that specific remapped shortcut would send
  completely unmasked.
- There's no live preview while typing anymore - masking only happens at the moment of
  submission (see "Why masking happens at submit time, not as you type" above). You
  won't see a value turn into a token until you actually send; the popup's token list
  is empty until then too. This is a deliberate trade-off for not corrupting multi-line
  pastes and editing, not an oversight.
- Masking is content-script-only (visible, in-place DOM rewriting), not a network-layer
  interceptor — matches InfraMask's original design decision (Section 10, alternative
  C) to keep masking transparent and editable rather than invisible.
- `credential_kv` is a keyword + value heuristic (`password=`, `token:`, etc.), not a
  secret-strength classifier — it will not catch a bare secret with no labeling key
  next to it, and a keyword immediately followed by a JWT or API key gets classified
  as `credential_kv` rather than `jwt`/`api_key` (longest-match-wins picks the match
  that includes the label). Both still get masked; only the reported *type* differs.
- All detectors are regex-based and only recognize `key: value` or `key=value` syntax
  (YAML, `.properties`, JSON-like, env-style) - this covers pasting straight from config
  files, which is the primary case this was built for. It does **not** catch a secret
  described in free-form prose with no separator, e.g. "the password is hunter2" or
  "my SASL username is admin" - there's no reliable regex for that without a much
  higher false-positive rate, and it would need an NLP-based approach to do properly.
  If your team pastes secrets as prose rather than key/value pairs, this won't catch it.
- Earlier versions of the `hostname` detector accepted any 2+-letter final segment as a
  plausible TLD, which meant a dotted config *key name* like `db.host` or
  `spring.kafka.bootstrap-servers` (common in a pasted `.properties` file) got masked as
  if it were a hostname itself - not even a value, just the key. Fixed by requiring the
  final segment to be either an internal-infra suffix (`internal`, `corp`, `local`,
  `svc`, `cluster.local`) or a curated list of common public TLDs (`com`, `net`, `org`,
  `io`, `dev`, `ai`, `co`, `gov`, `edu`, `app`, `cloud`) - trades a little recall on
  unusual TLDs for not mangling ordinary property keys that aren't hostnames at all.
- PII detection is regex-based, not a trained classifier - `phone` requires
  separators (`555-0132`, not `5550132`) to avoid flagging arbitrary 10-digit numbers,
  and `credit_card` requires a full Luhn-checksum pass, not just the right digit
  count, to avoid flagging order/tracking IDs of the same length. Both trade recall
  for fewer false positives; a real card number with no separators and a typo that
  still happens to pass Luhn is the kind of edge case that could slip through.
- No detector for personal names, street addresses, or retailer-specific identifiers
  (loyalty numbers, gift card codes) - formats vary too much per business to regex
  reliably. `src/detectors.js` is the extension point if you need one for your own data.
- Not yet published to the Chrome Web Store; "Load unpacked" only.
- Still hardcoded to the three sites listed in `manifest.json`'s `content_scripts.matches`
  and `src/site-adapters.js` - not a drop-in for an arbitrary chat UI. Adding a new site
  means adding both a `matches` entry and a selector/adapter entry.
