---
"@shipfox/client-workflows": patch
"@shipfox/workflow-templates": patch
"@shipfox/api-workflows": patch
---

Explains a `run_after` skip in the run UI: the copy says what did not succeed and which `run_after` value runs the step or job after a failure. A job skipped by `run_after: failure` now records the check that rejected it. The skipped-step copy is worded for a step instead of a job. The `write-a-workflow` and `debug-a-failed-run` skills now describe `run_after`.
