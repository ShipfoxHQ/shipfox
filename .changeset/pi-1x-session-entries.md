---
"@shipfox/api-logs": patch
"@shipfox/client-logs": patch
"@shipfox/react-ui": patch
---

Agent activity reads Pi 1.x session entries, and Markdown keeps text written with XML-like tags.

- **System prompt:** a structured system message becomes a `system-prompt` row. The body has the sections in order, removed sections, and the names of added or removed tools. The row metadata lists the section names. The client shows this row as plain text, so the prompt keeps its tags and indentation.
- **Context edits:** a `context_edit` entry becomes a lifecycle row that says whether the target message was removed or replaced, with the replacement text.
- **Usage:** a `usage` entry becomes a lifecycle row with its kind, note, model, tokens, and cost.
- **Markdown:** raw HTML is shown as literal text instead of being dropped. Before, a block such as `<issue>` hid every line up to the next blank line.

Session rows are parsed and stored when the session is ingested. Sessions recorded before this release keep their raw rows.
