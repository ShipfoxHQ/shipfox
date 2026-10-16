---
"@shipfox/workflow-document": major
"@shipfox/api-definitions-dto": major
"@shipfox/api-definitions": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent-access-dto": minor
---

Models concurrent steps: the document fields, normalization, sync rules, and storage.

**Breaking:** `WorkflowDocumentJob['steps']` now holds steps and `parallel` blocks, so code that reads `job.steps` as a list of steps must use `jobSteps(job)`. `WorkflowModelStep` gains the `wait` and `cancel` kinds, so a `switch` over `kind` must handle them.

- **Document:** steps gain `background`, `wait`, `wait_all`, and `cancel`, and a job's `steps` can hold a `parallel` block of at least two steps. `jobSteps(job)` yields every step with its document path, `parallel` members included, and every walker over a job document now uses it, so a `uses:` or `prompt` file inside a block is still found. `job.steps` now also holds blocks. `workflowDocumentSchema`, `parseWorkflowDocument`, and `buildWorkflowJsonSchema` accept the five keys. `rawJobSteps(input)` walks the steps of a document that is not parsed yet.
- **Workflow model:** steps gain `background`, `parallelGroup`, and `joinedAt`, plus `wait` and `cancel` step kinds. Normalization expands each `parallel` block into background steps followed by a wait, resolves `wait_all` to explicit targets, adds a closing wait when background steps are still running, and checks the order rules: a background step needs a `key`, takes no gate, and cannot overlap a `checkout`, a gate cannot restart past a running background step, and concurrent steps cannot share an agent session. A step reads a background step only after the wait that joins it. A model with a concurrent step is stored as snapshot version 8.
- **Storage:** steps gain `background`, `parallel_group`, and `joined_at`, step attempts gain `cancel_requested_at`, and `wait` and `cancel` are step types. Dispatch context and `env_sources` skip a background step until a wait has joined it.
- **API:** the step type of a job detail and of the agent access read tools can be `wait` or `cancel`.
