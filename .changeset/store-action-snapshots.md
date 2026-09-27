---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
---

Adds the action bundle codec. `encodeActionBundle` writes the files of an action directory as canonical JSON with a `sha256:<hex>` digest and a gzipped stored form, and `decodeActionBundle` reads it back after checking the digest.

Definitions stores action snapshots per workspace and digest, and the new `getActionSnapshot` inter-module method returns the manifest, the gzipped bundle as base64, and its byte count, or the `action-snapshot-not-found` known error.
