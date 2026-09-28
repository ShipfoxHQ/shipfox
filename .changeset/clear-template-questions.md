---
"@shipfox/workflow-templates": patch
---

Template setup questions now lead with what each choice means for the user. The agent lists one line per choice with the default marked, uses the names it already knows, and leaves out how the workflow implements the choice. When it needs a value such as a Slack channel ID, it asks one short question and, if a local tool can list channels, suggests one. The failed run report template's questions and choices are rewritten in plain terms.
