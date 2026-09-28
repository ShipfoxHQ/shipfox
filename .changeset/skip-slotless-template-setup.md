---
"@shipfox/workflow-templates": patch
---

Guided template setup no longer looks for install, build, or test commands when the template has no command slots, so the agent does not ask the user about setup it does not need.
