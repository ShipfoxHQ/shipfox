---
"@shipfox/workflow-templates": patch
---

Guided template setup asks fewer, plainer questions. The agent chooses install, build, and test commands from the repository instead of asking the user to confirm them, and asks only when several CI workflows could be watched. Option markers can list several choices, such as `# option:report_outcomes=needs_person,both begin`.

The agent also binds the template's default model without asking and tells the user they can change it later in the workflow file.
