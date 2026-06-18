---
"@shipfox/client-projects": patch
---

Drop the workflow run page and its related run-list components, now owned by
`@shipfox/client-workflows`. Removes the duplicated `WorkflowRunPage`,
`ProjectRunsPage`, runs search params, `WorkflowRunsList`, `RunRow`,
`RunStatusFilter`, and `StatusDot`, along with the run-list/run-detail query
hooks they relied on. The package keeps the manual-fire mutation that the
workflows tab still uses, and prunes the now-unused `zod` and `@shipfox/vite`
dependencies.
