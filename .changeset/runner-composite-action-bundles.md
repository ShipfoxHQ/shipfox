---
"@shipfox/runner-execution": patch
"@shipfox/runner-orchestration": patch
"@shipfox/runner-protocol": patch
---

Runs the steps of a composite action with the action files in place.

- **Actions directory:** the setup step report carries `actions_dir`, the job directory where the runner extracts action bundles.
- **Composite bundles:** before a run, agent, action, or post step with `action_bundles` runs, the runner downloads and extracts each of those bundles once per job, into the directory `actionBundleDirectoryName` names. A load failure fails the step with reason `action_unavailable`.
- **Bundle request:** `requestActionBundle` takes an optional `digest`, sent as the `digest` query parameter, so a step can name its own action or the composite action that holds it.
