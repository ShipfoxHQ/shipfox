---
"@shipfox/api-integration-clickup": minor
"@shipfox/api-integration-clickup-dto": minor
"@shipfox/actions": minor
---

Add the `add_tag`, `remove_tag`, and `set_custom_field` ClickUp tools. A workflow can now record its state on a task in tags, and write a result to a custom field instead of the description. `add_tag` creates the tag in the task's Space when it doesn't exist. The generated action tool types include the new tools.
