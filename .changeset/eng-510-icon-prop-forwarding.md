---
"@shipfox/react-ui": patch
---

Forward props on the `componentLine` and `componentFill` custom icons so `className`, `aria-*`, and sizing reach the rendered `<svg>` like every other icon. Previously these two glyphs dropped all props, so `<Icon name="componentLine">` (the neutral fallback `IntegrationIcon` and `TriggerSourceIcon` use for uncataloged sources) rendered at its intrinsic size with no accessible name regardless of what the caller passed.
