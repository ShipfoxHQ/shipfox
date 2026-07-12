# Shipfox Redact

Redaction helpers for secrets, credentials, URLs, free text, and structured values.

## What it does

- **`redactUrlCredentials(text)`**: Masks credentials in every `scheme://` URL
  found in free text.
- **`stripUrlCredentials(url)`**: Removes user information from one URL without
  leaving a masked user marker.
- **`redactSecrets(text, secrets)`**: Masks literal secrets and URL credentials.
- **`safeRedactionPrefixLength(buffer, secrets)`**: Finds the part of a stream
  buffer that is safe to mask and emit without splitting a secret.
- **`secretWireForms(secret)`**: Returns the literal, base64, base64url,
  URL-encoded, and hex forms of a secret.
- **`redactSensitiveUrl(url)`**: Masks URL credentials plus sensitive query and
  fragment fields used by signed URLs and OAuth callbacks.
- **`redactSensitiveText(text, options)`**: Masks authorization values, cookies,
  signatures, URLs, key-value pairs, and configured secrets in free text.
- **`createRedactor(options)`**: Creates a recursive redactor for strings,
  arrays, objects, errors, URLs, and dates. It copies input values and replaces
  circular references with `[Circular]`.
- **`REDACTION_PLACEHOLDER`**: Exposes the `***` value written in place of
  sensitive data.

## Installation

```sh
pnpm add @shipfox/redact
```

## Usage

```ts
import {createRedactor, redactSensitiveUrl} from '@shipfox/redact';

const redact = createRedactor({secrets: ['your-api-token']});

const attributes = redact.redact({
  authorization: 'Bearer project-token',
  databaseUrl: 'postgres://user:password@db.example/glint',
});

const safeUrl = redactSensitiveUrl(
  'https://objects.example/file?X-Amz-Credential=id&X-Amz-Signature=signature',
);
```

## Behavior notes

The package ships ECMAScript modules compiled to ES2022. It uses the standard
`URL` and `TextEncoder` APIs and has no runtime dependencies. It works in
Node.js and browser-like runtimes that provide those APIs.

The package does not know which application values are secret. Pass configured
secrets through `StructuredRedactionOptions` or derive their forms with
`secretWireForms`.

`redactUrlCredentials` leaves scp-style remotes such as `git@host:path`
unchanged. Such values do not have a password field. Passing the real secret to
`redactSecrets` or `createRedactor` remains the safety net for unusual forms.

The package follows semantic versioning. Additive helpers ship in minor
versions. Breaking changes to exports or masking behavior require a major
version.

## Development

```sh
turbo check --filter=@shipfox/redact
turbo type --filter=@shipfox/redact
turbo test --filter=@shipfox/redact
pnpm --filter=@shipfox/redact test:external
```

The external test packs the package and installs it in a clean temporary
project. It checks runtime imports, type imports, and the published file list.

## License

MIT
