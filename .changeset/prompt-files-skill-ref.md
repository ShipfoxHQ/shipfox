---
"@shipfox/workflow-templates": patch
---

The validate-workflow-change (revision 4) and test-workflow-change (revision 3) skills explain that prompt files are read from the dev run's `ref`. To check or test an edited prompt file, the agent pushes the branch and passes it as `ref`.
