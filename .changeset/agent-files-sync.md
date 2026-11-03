---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
---

Definition sync reads agent files from `.shipfox/agents/`.

- **Document:** `agentDocumentSchema`, `parseAgentDocument`, and `buildAgentJsonSchema` describe an agent file. The file name without its extension is the agent key. `shippy` adds to the built-in agent and every field is optional. Any other agent requires `description` and `instructions`.
- **Sync:** each agent file is checked on its own and stored in the new `definitions_agents` table. An invalid file keeps its last valid version and records the error, and it never stops workflow sync. A deleted file deletes its agent. A repository with only agent files syncs. The `DEFINITION_AGENT_PATH` setting changes the folder.
- **Contract:** the new `listProjectAgents` inter-module method returns the agents of a project. Test doubles of `DefinitionsInterModuleClient` must add it.
