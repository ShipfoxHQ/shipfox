---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
---

Step diagnostics name the composite actions that hold a step.

- **Step attempt detail:** the response gains `parent_step_id` and `step_path`, the step's labels from its outermost composite down to the step, such as `["setup", "lint"]`. A label is the step key, or the name when the step has no key.
- **Failure annotations:** an inner step of a composite reads as its key path, such as `setup › lint`, as on the run page. Job steps read as before.
- **MCP:** `get_step_attempt` returns `parent_step_id` and `step_path`.
