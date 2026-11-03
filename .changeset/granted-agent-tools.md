---
"@shipfox/api-agent": minor
"@shipfox/api-definitions": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
---

An agent file can grant integration tools with `integrations:`, using the selectors and `allow_write` rule of an agent step.

- **Sync:** definition sync checks the selectors, connections, and `allow_write` of each agent file. An invalid file keeps its last valid version.
- **Conversations:** the tools of a granted connection appear beside the built-in tools, named by connection. A tool removed from the file stops being callable.
- **Write tools:** a write call is recorded before it runs. A retry that finds it started does not run it again. It stores a result with the outcome `unknown`, and the model reads the state before it tries again.
- **Integrations:** the new `resolveAgentTools` operation expands selectors into tool grants. `getAgentToolsContext` no longer needs a default connection.
