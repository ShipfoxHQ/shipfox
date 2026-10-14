---
"@shipfox/api-agent-dto": minor
"@shipfox/workflow-document": minor
"@shipfox/expression": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-logs": minor
---

Agent steps read the same repository instructions and skills as a developer's coding agent, and `repository_context` controls them.

- **Workflow schema:** an agent step accepts `repository_context`: `false` turns repository context off, and the long form sets `instructions` and `skills` separately. Each toggle accepts a `${{ }}` expression that resolves to `true` or `false` when the step is dispatched. `skills` also accepts a list of skill names. The field is registered as the `agent.repository_context` interpolation field.
- **Agent contract:** `@shipfox/api-agent-dto` exports `agentRepositoryContextConfigSchema`, the instruction file names for each harness (`claude` tries `CLAUDE.md` first and `pi` tries `AGENTS.md` first), the skill directories, the 64 KiB instruction limit, and `AGENT_SHIPFOX_SYSTEM_PROMPT`, the guidance that both harnesses add to their system prompt.
- **Session view:** a `shipfox_repository_context` session entry renders as a "Repository context" row that lists the instruction files and skills the step loaded, or shows that they were off.
