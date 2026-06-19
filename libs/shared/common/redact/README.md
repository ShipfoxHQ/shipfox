# Shipfox Redact

Shared credential-redaction helpers. One home for the redaction techniques used
across Shipfox so they cannot drift.

## What it does

- **`redactUrlCredentials(text)`** scrubs `user:pass@` (and bare `user@`)
  credentials from free text, for every `scheme://` URL it finds (http, https,
  git, ssh, ...). Use it on log lines and command stderr.
- **`stripUrlCredentials(url)`** removes the userinfo from a single known URL via
  `new URL()`, returning a clean URL with no `***@` residue. Use it on one URL
  field you control. When the value does not parse as a URL it falls back to
  `redactUrlCredentials`, so a credential with a malformed authority is still
  masked; a credential-free non-URL (scp-style `git@host:path`) is returned
  unchanged.
- **`redactSecrets(text, secrets)`** removes every occurrence of each literal
  secret, then applies `redactUrlCredentials`. The helper only removes the
  literals it is given, so pass every wire form a secret takes; use
  `secretWireForms` to derive them.
- **`secretWireForms(secret)`** derives every wire form one secret can appear as
  in captured output: the literal, its base64 and base64url forms (all three
  phase alignments, so a secret embedded in a larger encoded blob is masked too),
  its URL-encoded form, and its lower- and upper-case hex. The result is
  deduplicated and sorted longest-first, ready to hand straight to `redactSecrets`.
  The literal is always included so a registered secret is never left unmasked;
  its derived forms are dropped below 8 characters, because a short derivation
  matches common encoded text and would scrub unrelated output.
- **`REDACTION_PLACEHOLDER`** is the `'***'` string every redaction writes.

scp-style remotes (`git@host:path`) are left untouched on purpose: an scp URL
carrying a password is not a real git form, and redacting it would corrupt
structurally identical strings (Docker digests, `host:port`). Literal secrets are
the backstop for those.

## Installation

```bash
pnpm add @shipfox/redact
```

## Usage

```ts
import {
  redactSecrets,
  redactUrlCredentials,
  secretWireForms,
  stripUrlCredentials,
} from "@shipfox/redact";

redactUrlCredentials("fatal: clone of https://x:tok@github.com/o/r.git failed");
// -> "fatal: clone of https://***@github.com/o/r.git failed"

stripUrlCredentials("https://x-access-token:tok@github.com/o/r.git");
// -> "https://github.com/o/r.git"

redactSecrets("Authorization: Basic dXNlcjp0b2tlbg==", ["dXNlcjp0b2tlbg=="]);
// -> "Authorization: Basic ***"

// Mask a token in every form it might appear as (base64, hex, URL-encoded, ...).
redactSecrets("digest=" + tokenAsHex, secretWireForms(token));
// -> "digest=***"
```

## Development

```sh
turbo check --filter=@shipfox/redact
turbo type --filter=@shipfox/redact
turbo test --filter=@shipfox/redact
```

## License

MIT
