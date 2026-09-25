---
"@shipfox/workflow-templates": minor
---

Revise the create-workflow-from-template skill: users confirm the full model and thinking setting, replay events are limited to the selected project, failed real runs need an explicit decision before any writes repeat, and a successful run is confirmed with the user before the pull request. The skill reads the template guide from `get_workflow_template`, no longer offers template upgrades, and skill files may now be up to 8 KiB.
