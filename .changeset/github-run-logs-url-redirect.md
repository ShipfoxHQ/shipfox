---
"@shipfox/api-integration-github": patch
---

Fixes two GitHub Actions log tools. The `get_workflow_run_logs_url` method of `actions_get` failed on every call, and now returns the short-lived `download_url` of the run logs archive with `archive_format` set to `zip`. `get_job_logs` ignored `return_content`, `tail_lines`, `run_id`, and `failed_only` and returned the whole log as `result`. It now returns the job log `logs_url`, or the last `tail_lines` lines as `logs_content` with `return_content`, and covers every failed job of a run with `run_id` and `failed_only`.
