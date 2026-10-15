---
"@shipfox/api-definitions": minor
---

Workflow sync accepts `runner.os` and `runner.arch` in fields resolved at step dispatch and `hashFiles()` in `run`, `env` values, and top-level action inputs. New issue codes report a misplaced or malformed call: `hash-files-in-field`, `hash-files-not-bare`, `hash-files-argument-not-literal`, `hash-files-path-invalid`, and `hash-files-path-outside-workspace`. A `runner` reference outside step dispatch reports `context-unavailable-at-fill-site` or `context-unavailable-at-predicate-site`.
