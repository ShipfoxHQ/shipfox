---
"@shipfox/api-definitions": patch
---

Adds resolution of action directories referenced with `uses`: reads each directory at a commit, validates its manifest, builds the bundle and digest, and enforces the action size and file-type limits.
