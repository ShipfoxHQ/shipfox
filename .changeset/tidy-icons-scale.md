---
"@shipfox/react-ui": patch
---

Fixes `CircleDottedLineIcon` to forward `className` and the rest of its props (instead of ignoring them), so it now scales with `size-12` and similar overrides, including the width/height `<Icon size>` resolves, rather than rendering at a fixed size.
