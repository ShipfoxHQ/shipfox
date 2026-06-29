---
"@shipfox/client-workflows": patch
---

Add a per-step "View source" action to the Workflow Run Page. Each located step shows an icon-only button on the far right of its row (revealed on hover/focus, reachable while the row is collapsed) that opens the workflow source panel highlighting the step's lines (from `source_location`) and scrolling them into view. Source focus is page-level state decoupled from row selection, so opening or closing the panel never collapses the expanded step; the summary and step controls keep mutually exclusive `aria-expanded` and focus returns to whichever button opened the panel.
