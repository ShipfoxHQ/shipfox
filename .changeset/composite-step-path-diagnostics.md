---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": patch
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
---

Step diagnostics name the composite actions that hold a step.

- **Step attempt detail:** the response gains `parent_step_id` and `step_path`, the step's labels from its outermost composite down to the step, such as `["setup", "lint"]`. A label is the step key, or its name when it has no key.
- **Stored step errors:** an `if` that cannot be evaluated and a failed background step name an inner step by its key path, such as `setup › lint`.
- **Failure annotations:** an inner step reads as its key path, as on the run page. Job steps read as before.
- **MCP:** `get_step_attempt` returns `parent_step_id` and `step_path`.
- **Limits:** `MAX_ACTION_NESTING_DEPTH` and `MAX_STEP_PATH_LENGTH` are exported from `@shipfox/api-definitions-dto`.
