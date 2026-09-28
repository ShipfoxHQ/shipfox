---
"@shipfox/workflow-templates": minor
---

Updates the `fix-dependency-ci` template to revision 3 and renames it to "Repair failing pull request CI".

A new `pr_selection` option keeps dependency-bot pull requests as the default and adds pull requests with a chosen label or all same-repository pull requests. Pushed repair commits carry a `Shipfox-CI-Repair:` trailer. The trigger ignores failures on those commits whichever account pushed them, so a repair that still fails never starts another.
