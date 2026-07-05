/** Replacement written in place of any redacted secret or URL credential. */
export const REDACTION_PLACEHOLDER = '***';

// Bounded scheme length keeps the match linear: an unbounded `*` before the
// `://` literal backtracks O(n) per start position (O(n^2) overall) on long
// adversarial input, while a capped repetition stays O(n). No real URL scheme
// approaches this length.
const SCHEME_URL_CREDENTIALS = /([a-z][a-z0-9+.-]{0,31}:\/\/)[^@\s/?#]+@/gi;

/**
 * Strips inline `user:pass@` (or bare `user@`) credentials from free text such
 * as log lines or git command stderr, for every `scheme://` URL it contains
 * (http, https, git, ssh, ...). The whole userinfo is replaced, matching the
 * runner's prior behaviour where a bare `user@` is scrubbed too.
 *
 * scp-style remotes (`git@host:path`) are intentionally left untouched: an scp
 * URL carrying a password is not a real git form, so redacting it buys no
 * security but would corrupt structurally identical strings (Docker digests
 * `name:tag@sha256:...`, `user:pass@host:port`). Literal secrets are removed by
 * {@link redactSecrets}; this pass only handles `://` URLs.
 *
 * This pass redacts userinfo up to the first `@` and treats `/`, `?`, and `#` as
 * userinfo boundaries so it never bleeds into a path or query that contains an
 * `@`. A credential whose userinfo itself contains a raw `@`, `/`, `?`, or `#`
 * (all invalid unencoded per RFC 3986, but git can echo them) is therefore only
 * partially masked here; {@link redactSecrets}'s literal pass is the backstop
 * that removes such values in full.
 */
export function redactUrlCredentials(text: string): string {
  return text.replace(SCHEME_URL_CREDENTIALS, `$1${REDACTION_PLACEHOLDER}@`);
}

/**
 * Removes a single known URL's `user:pass@` userinfo. For a parseable URL it
 * returns a clean URL with no `***@` residue; with no credentials it returns the
 * input unchanged. When the value does not parse as a URL it falls back to the
 * inline {@link redactUrlCredentials} scrubber, so a credential-bearing value
 * whose authority is malformed (bad port, broken IPv6) is still masked (to
 * `***@`) instead of being logged verbatim. A credential-free non-URL such as an
 * scp-style remote (`git@host:path`) has no `scheme://`, so the fallback leaves
 * it untouched.
 *
 * Defense in depth: callers must keep credential-free URLs, but a helper whose
 * job is to make a value safe to log must also strip any userinfo a mistake left
 * in (e.g. `https://x-access-token:<token>@host/...`).
 */
export function stripUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return redactUrlCredentials(url);
  }
}

/**
 * Removes every occurrence of each literal secret plus any `scheme://` URL
 * credential from `text`, so an error never carries token material into a log or
 * result. Literal secrets are scrubbed first, then URL userinfo.
 *
 * Only the literal secrets passed are removed; deriving every wire form a
 * credential takes (e.g. the base64 of `user:token`) is the caller's job.
 *
 * Longer secrets are removed first, so when one secret is a substring of another
 * the output is the same no matter what order the caller lists them in. Pass
 * real, high-entropy secrets only; a trivially short literal (e.g. a single
 * character) would scrub unrelated text.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  // Remove longer secrets first: scrubbing a shorter secret that is a substring
  // of a longer one would otherwise leave the longer secret's tail visible.
  const longestFirst = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of longestFirst) {
    redacted = redacted.split(secret).join(REDACTION_PLACEHOLDER);
  }
  return redactUrlCredentials(redacted);
}

/**
 * Returns the largest prefix length of `buffer` that can be redacted and emitted now without
 * risking a registered secret being split across this prefix and a later chunk.
 *
 * Callers that stream output should keep `buffer.slice(result)` as lookbehind, redact and emit
 * only `buffer.slice(0, result)`, and flush the remainder when the stream closes.
 */
export function safeRedactionPrefixLength(buffer: string, secrets: readonly string[]): number {
  const candidates = secrets.filter(Boolean);
  const maxSecretLen = candidates.reduce((max, secret) => Math.max(max, secret.length), 0);
  const hold = Math.max(0, maxSecretLen - 1);
  let cut = buffer.length - hold;
  if (cut <= 0) return 0;
  for (let moved = true; moved && cut > 0; ) {
    moved = false;
    const windowStart = Math.max(0, cut - maxSecretLen + 1);
    for (let start = windowStart; start < cut; start++) {
      const straddles = candidates.some(
        (secret) => start + secret.length > cut && buffer.startsWith(secret, start),
      );
      if (straddles) {
        cut = start;
        moved = true;
        break;
      }
    }
  }
  return cut;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// A derived form (base64/base64url phase substrings, hex, URL-encoding) is dropped below this
// length: a short derivation matches common encoded text and would scrub unrelated output. The
// literal secret is never dropped, because failing to mask a registered secret is a leak. A
// derived form's length scales with the secret, so this only ever bites a short secret; a long
// token keeps every form.
const MIN_DERIVED_FORM_LENGTH = 8;

// Self-contained, unpadded base64 so this stays a pure-JS (browser-safe) module: no
// node:buffer, no btoa. Padding is irrelevant here because callers only ever slice the
// stable middle of the output (see base64Alignments).
function base64Encode(bytes: Uint8Array, alphabet: string): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0b11) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += alphabet[((b1 & 0b1111) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += alphabet[b2 & 0b111111];
  }
  return out;
}

/**
 * The three phase-aligned base64 substrings a secret yields when embedded at byte offset
 * 0, 1, or 2 (mod 3) inside a larger base64 blob (e.g. a token inside a base64-encoded
 * request body). For each phase we encode `phase` filler bytes followed by the secret,
 * drop the `lead` chars the filler produced, and keep the `keep` chars that depend only on
 * the secret's own bytes — the run that appears no matter what surrounds the secret.
 */
function base64Alignments(bytes: Uint8Array, alphabet: string): string[] {
  const alignments: string[] = [];
  for (let phase = 0; phase < 3; phase++) {
    const padded = new Uint8Array(phase + bytes.length);
    padded.set(bytes, phase);
    const encoded = base64Encode(padded, alphabet);
    const lead = Math.ceil((phase * 8) / 6);
    const lostBits = lead * 6 - phase * 8;
    const keep = Math.floor((bytes.length * 8 - lostBits) / 6);
    alignments.push(encoded.slice(lead, lead + keep));
  }
  return alignments;
}

function hexEncode(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Every wire form a secret can appear as in captured output, ready to hand straight to
 * {@link redactSecrets}: the literal, its base64 and base64url forms (all three phase
 * alignments, so a secret embedded in a larger encoded blob is masked too), its URL-encoded
 * form, and its lower- and upper-case hex. Deduplicated and sorted longest-first.
 *
 * The literal is always included so a registered secret is never left unmasked. Its derived
 * forms are dropped below {@link MIN_DERIVED_FORM_LENGTH} chars, because a short derivation
 * (e.g. the base64 substring of a tiny secret) matches common encoded text and would scrub
 * unrelated output. A derived form's length scales with the secret, so this only bites a short
 * secret; a genuine long token keeps every form.
 *
 * redactSecrets' contract still holds: pass real, high-entropy secrets. This is the "deriving
 * every wire form a credential takes" step that redactSecrets leaves to callers, given one
 * home so every masker derives the same set.
 */
export function secretWireForms(secret: string): string[] {
  if (!secret) return [];
  const bytes = new TextEncoder().encode(secret);
  const hex = hexEncode(bytes);
  const derived = [
    ...base64Alignments(bytes, BASE64_ALPHABET),
    ...base64Alignments(bytes, BASE64URL_ALPHABET),
    encodeURIComponent(secret),
    hex,
    hex.toUpperCase(),
  ].filter((form) => form.length >= MIN_DERIVED_FORM_LENGTH);
  // The literal always masks; only its derived forms are length-gated.
  return [...new Set([secret, ...derived])].sort((a, b) => b.length - a.length);
}
