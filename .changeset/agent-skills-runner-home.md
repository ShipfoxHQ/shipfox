---
"@shipfox/api-agent-dto": minor
"@shipfox/api-logs": patch
"@shipfox/workflow-document": patch
---

Adds `AGENT_HOME_INSTRUCTION_FILE_PATHS`, the instruction files that agent steps read from the runner home directory for each harness: `.pi/agent/AGENTS.md` and `.claude/CLAUDE.md`, in the order of the harness. The `Repository context` session row now names the directory of each skill, for example `Skills: review (.agents/skills); tdd (~/.agents/skills).` The `repository_context` descriptions now say that agent steps also read instructions and skills from the runner home directory.
