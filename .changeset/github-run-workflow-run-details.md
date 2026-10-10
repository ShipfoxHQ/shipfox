---
"@shipfox/api-integration-github": patch
---

The `run_workflow` method of `actions_run_trigger` now returns the run it started, as `workflow_run_id`, `run_url`, and `html_url`. It returned an empty result before, so a workflow could not find the run to read, cancel, or rerun it.
