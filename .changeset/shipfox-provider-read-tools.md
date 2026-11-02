---
"@shipfox/api-integration-shipfox": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-agent": minor
"@shipfox/actions": patch
---

The `shipfox` provider gains six read tools, so a conversation or an agent step can troubleshoot a run.

- **New tools:** `list_workflow_run_jobs`, `get_workflow_job`, `list_workflow_step_attempts`, `list_workflow_run_job_explanations`, `get_workflow_definition_source`, and `search_docs`. `get_workflow_job` returns the job outputs, such as `pr_url`.
- **`@shipfox/api-integration-shipfox`:** `createShipfoxAgentToolsProvider` takes a required `docs` cache. A conversation caller can't read a run, job, step, or definition from another project.
- **`@shipfox/api-integration-core`:** the inter-module clients for providers include the docs cache.
- **`@shipfox/actions`:** the generated tool types include the new tools.
- **`@shipfox/api-agent`:** adds `createReadSkillTool`, an Agent-local `read_skill` tool that reads shipped skills.
