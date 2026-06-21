---
"@shipfox/react-ui": minor
---

Add the `Dot` component: a small filled status/presence dot. A `variant` prop
(`neutral` | `info` | `feature` | `success` | `warning` | `error`, mirroring the
`Badge` variant set) sets the color, defaulting to a muted neutral; colors map to
the `--tag-*-text` family so a dot matches the badge/status pill it stands in for. Set `ripple` to radiate fading concentric rings
for live or loading states; the animation honors `prefers-reduced-motion`. Color
flows through `currentColor`, so the dot and its rings always stay in sync.
