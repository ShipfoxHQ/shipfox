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
