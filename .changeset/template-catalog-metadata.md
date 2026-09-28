---
"@shipfox/workflow-templates": minor
---

Shipped templates now carry catalog metadata: keywords, flow, writes, prerequisites, and related templates. Manifest `writes` and `prerequisites` no longer take `when` conditions: a write is `{provider?, action}`, and a prerequisite is a string.
