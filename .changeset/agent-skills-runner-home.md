---
"@shipfox/api-agent-dto": minor
"@shipfox/api-logs": patch
"@shipfox/workflow-document": patch
---

Agent steps read the files of mainstream coding agents (Claude Code, Codex, OpenCode, Cursor, and pi) in the repository and in the runner home directory. `AGENT_REPOSITORY_SKILL_DIRECTORIES` adds `.pi/skills`, `.opencode/skills`, and `.cursor/skills`. The new `AGENT_HOME_SKILL_DIRECTORIES` lists the user skill directories, and the new `AGENT_HOME_INSTRUCTION_FILE_PATHS` lists the global instruction files for each harness, in the order the runner tries them. The `Repository context` session row now names the directory of each skill, for example `Skills: review (.agents/skills); tdd (~/.agents/skills).`
