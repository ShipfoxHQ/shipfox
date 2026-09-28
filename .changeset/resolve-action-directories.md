---
"@shipfox/api-definitions": patch
---

Adds internal action resolution for workflow sync: it reads each action directory referenced with `uses` at the synced commit, parses its manifest, and builds the bundle and its digest. It enforces the action size limits and rejects symlinks, submodules, and files that are not UTF-8 text. Sync does not use it yet.
