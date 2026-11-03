---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions": minor
"@shipfox/api-definitions-dto": minor
---

Definition sync reads `.shipfox/agents/` and stores each agent file as a project agent.

- **Agent document:** `agentDocumentSchema` and `parseAgentDocument` describe one file in `.shipfox/agents/`. The file name without its extension is the agent key. `shippy` is the built-in agent and every field of its file is optional. Any other key is a custom agent and requires `description` and `instructions`. The document reuses the agent step `model`, `provider`, `thinking`, `integrations`, and prompt schemas, and `workflowDocumentPromptSchema` is now exported. `buildAgentDocumentJsonSchema` publishes the JSON schema.
- **Sync:** the sync workflow lists the folder set by `DEFINITION_AGENT_PATH` and applies agent files after the workflows, behind the `definition-sync-agents` patch. Each file validates on its own: an invalid file becomes a diagnostic and keeps its last valid row, a nested file creates no agent, a deleted file deletes its row, and a renamed file starts a new agent. `no-workflow-files` only fails a repository with neither workflow nor agent files.
- **Storage:** the new `definitions_agents` table is unique on `(project_id, key)` and holds the joined instructions with every prompt `file` part inlined at the definition commit.
- **Inter-module:** `listProjectAgents` returns the project's agents with their last error.
- `resolvePromptFiles` takes a list of `file` uses instead of workflows; `collectWorkflowPromptFileUses` builds that list for workflows and their composite actions.
