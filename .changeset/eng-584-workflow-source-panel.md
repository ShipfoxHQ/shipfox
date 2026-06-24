---
"@shipfox/client-workflows": patch
---

Add a resizable workflow source panel to the run page. The run summary exposes a Source control that opens the run's workflow YAML (from `source_snapshot`) in a page-level right panel, leaving the jobs graph and step attempts visible. The panel defaults to 720px and can be dragged between 420px and `min(1280px, 85vw)`.
