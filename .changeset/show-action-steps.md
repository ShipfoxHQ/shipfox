---
"@shipfox/client-logs": minor
"@shipfox/client-workflows": minor
---

The run page shows action steps (`uses`).

- **Step inspector:** an action step shows an `Action` badge and an Action section with the `uses` path, a short snapshot digest, the source commit on dev runs, and the node and `@shipfox/actions` versions from the step's first log line. It lists the resolved inputs, with secret-bound inputs shown as `*** (secrets.KEY)`, and each integration alias with its connection and granted tools marked Read or Write.
- **Failures:** callouts explain `action_input_invalid`, `action_unavailable`, an early exit, an out-of-memory kill, and missing, undeclared, mistyped, or oversized outputs. An invalid input also shows as "Step did not run" in the step's log area, naming the input.
- **Logs:** action tool calls reuse the tool-step rows, named `<alias>__<tool>` and resolved from the step's bindings, with the alias and connection in the expanded row. A download shows its file name, size, media type, and SHA-256. A failed write whose outcome is unknown reads "outcome unknown", and a call still open when the step ended reads "interrupted".
- **`@shipfox/client-logs`:** `IntegrationActionTool` accepts optional `alias` and `result` fields, and `ActionPresentation` accepts optional `outcome` and `meta` fields.
