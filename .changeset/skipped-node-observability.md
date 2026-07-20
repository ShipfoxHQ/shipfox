---
"@shipfox/api-workflows-dto": patch
"@shipfox/api-workflows": patch
"@shipfox/client-workflows": patch
---

Surface skipped jobs and steps in the run-detail DTO and UI. The step DTO gains a
`status`/`status_reason` enum and both the job and step DTOs expose a server-derived,
secrets-free `evaluation_trace` explaining why a node was skipped (the evaluated `if:`
or the implicit default gate and its result). The run-detail view renders skipped
jobs and steps muted in the DAG and step list, shows the evaluated condition alongside
the step detail, and renders a broken condition (`condition_errored`) as a distinct
warning signal rather than an ordinary skip. Skipped steps, which have no step attempt,
now appear in the step list via the read-model (no new outbox event needed).
