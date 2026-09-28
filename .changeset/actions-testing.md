---
"@shipfox/actions": minor
---

Adds `@shipfox/actions/testing`, which runs an action from a unit test with fake tools.

- **`runAction(actionDir, {inputs, tools, workspace, env, timeoutMs})`** checks the inputs against `action.yml`, starts a fake `v1` tool endpoint, and runs the action in its own Node process with the real loader and bootstrap. It returns `status`, `exitCode`, typed `outputs`, `error`, the recorded `calls`, `logs`, `summary`, and the `workspace`.
- **Grants follow the manifest.** An ungranted tool, or a write tool without `allow_write`, fails with `tool-not-granted`. A granted tool without a fake fails with `no-fake-for-tool`.
- **`toolResult` and `toolError`** build fake results and errors. Download fakes return bytes, written with the runner's download code.

The contract adds `inheritedActionEnv`, the runner variables an action inherits. The package now depends on `@shipfox/expression`, `@shipfox/workflow-document`, and `yaml`, used by the testing entry only.
