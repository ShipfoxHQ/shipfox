---
"@shipfox/react-ui": patch
---

`CodeBlockContent` gains an opt-in `scrollHighlightedIntoView` prop. When set with a `highlightedLineRange`, it scrolls the first highlighted line to the vertical center of its nearest scrollable ancestor once the (async) highlighted markup renders. The scroll honors `prefers-reduced-motion` and is guarded so layout-less environments never throw. Default is off, so existing call sites are unaffected.
