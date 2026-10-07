---
'@shipfox/api-workflows-dto': minor
'@shipfox/api-secrets-dto': minor
'@shipfox/api-agent-access-dto': minor
---

Adds the `container_setup_failed` step error reason, which marks a failed job container pull or start as a setup failure. The agent access diagnostics accept the new reason. Secret bindings gain two targets for the setup step of a container job: `container_credential` for the registry username or password, and `container_env` for a container environment variable.
