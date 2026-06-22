---
"@shipfox/react-ui": minor
---

Add the `LogDisclosure` log primitive (`LogDisclosure`, `LogDisclosureTrigger`,
`LogDisclosureContent`), one collapsible built on `Collapsible` for both folding log groups
(GitHub `::group::`, with `rail={false}` around nested rows) and folding disclosures (agent
thinking, tool-result output, compaction summaries, with the default left rail). The header,
rail, and rows share a new `LogRowFrame` primitive (also exported, with `LogRowFrameProps`)
so they stay gutter-aligned.

`LogRow`'s `indent` is now a **depth level** rather than raw pixels: `LogRows` gains an
`indentStep` prop (default 16px per level) that resolves the level to padding, so callers write
`indent={depth + 1}` instead of `indent={(depth + 1) * 16}`. `Collapsible`'s open/close
animation is now gated behind `motion-safe:`, so it respects `prefers-reduced-motion`.
