---
"@shipfox/client-workflows": minor
---

The run page shows action posts as their own rows.

- **Post rows:** a post row carries the action icon. A failed post that leaves the job result unchanged shows a warning state and the line "This step failed. The job result is unchanged."
- **Step inspector:** the Action section shows the phase, `Main` or `Post`, and a post links to the step that declared it. A post gets the same failure guidance as an action step.
- **Entities:** `Step` and `WorkflowJobStepSummary` gain the optional `mainStepId` and `affectsJob` fields, set on post rows only.
