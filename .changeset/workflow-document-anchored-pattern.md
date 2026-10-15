---
"@shipfox/workflow-document": minor
---

Adds `parseAnchoredPattern(line)`, which reads a cache path or `hashFiles` pattern without Node imports, so the API and the runner accept the same patterns.

- **Result:** `{ok: true, anchor, pattern}`, with `anchor` `cwd`, `home` for `~/`, or `root` for `/`, and the pattern normalized relative to it. A bad line returns `{ok: false, reason}`, where `reason` is `empty`, `control-character`, `whole-anchor`, or `leaves-anchor`.
- **Normalization** matches `posix.normalize` from `node:path` for relative paths.
- **Entry:** the package root exports it, and `@shipfox/workflow-document/anchored-path` exports it without loading the workflow schemas.
