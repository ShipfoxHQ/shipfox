---
"@shipfox/client-workflows": patch
---

Replace the color-only job/run status dot with `WorkflowStatusIcon`, an icon-in-circle status glyph. Each state now carries a distinct shape plus the saturated `--tag-*-icon` tone, so the state is readable without relying on color alone: a dotted ring (pending), check / X / slash discs (succeeded / failed / cancelled), and a filled disc with an external ripple halo for the live running state (no spinner; honors reduced motion). Applied to the jobs graph nodes, the run-history rows, and the run-header pill.
