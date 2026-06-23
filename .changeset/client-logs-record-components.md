---
"@shipfox/client-logs": minor
"@shipfox/react-ui": minor
"@shipfox/api-logs-dto": patch
---

Add `@shipfox/client-logs`: the record components for the step-log read stream, composing the `@shipfox/react-ui` log primitives. This covers every process and system record (`output`, `group_start`/`group_end`, `end`, `gap`, `capped`, `runner_lost`); `agent_session` is rendered by the agent-sessions surface.

- `buildLogTree(records)` is a pure transform that reconstructs the group tree from the flat record list. `group_end` closes the matching `group_id` (so a `group_start` dropped under gap/backlog pressure does not mis-nest), record dispatch is an exhaustive switch, and each group node carries a precomputed `hasError` (a `runner_lost` in its subtree, a genuine failure; `stderr` is a channel, not an error) and subtree line count.
- `OutputLogRow` renders stdout/stderr (stderr gets a subtle left channel rule, not a background tint), `LogGroup` is a collapsible disclosure with running/duration/incomplete affordances and an inset error bar, the system markers render as timeline rows, and `LogView` is the top-level dispatcher with an empty state. Reviewed in a package-local Storybook captured by Argos (`client-logs`).
- `@shipfox/api-logs-dto` now measures UTF-8 byte length with `TextEncoder` instead of `node:buffer`, so this shared record contract is browser-safe for the client log viewer. Behavior is identical.
- `@shipfox/react-ui` gains two shared formatters in `utils`: `formatBytes` (new) and `formatDuration` (an ms-span, sub-second sibling to the existing `humanDuration`), so `client-logs` and future packages share one implementation instead of re-rolling them.
