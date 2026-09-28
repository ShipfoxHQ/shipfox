---
"@shipfox/registry-format": minor
---

Adds signed envelopes for version documents. `signRegistryVersionDocument` signs a document with an Ed25519 key through a `RegistrySigner`. `verifyRegistryVersionEnvelope` accepts an envelope only when a trusted key signed it and it names the requested package, version, and kind. Verification works in Node and in browsers. Public keys must be base64 DER Ed25519 keys.
