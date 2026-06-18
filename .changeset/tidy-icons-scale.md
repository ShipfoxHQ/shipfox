---
"@shipfox/react-ui": patch
---

Fixes `CircleDottedLineIcon` to honor `className` and `size` props instead of hardcoding a ~25px size, so it scales correctly when sized via `size-12` and similar overrides.
