---
"@shipfox/workflow-templates": minor
---

Adds the `fix-default-branch-ci` template. It investigates the first failed push or scheduled GitHub Actions run on the default branch after the workflow last passed. It skips failures while a repair pull request for the same workflow is open.

The agent works in a read-only checkout without saved credentials. It classifies the cause as a regression, flaky test, setup issue, external outage, or unknown. For an actionable cause, it opens a repair pull request after the configured checks pass. A separate job pushes the tested patch. External outages produce no writes. The optional `report` role posts repair pull requests, and optionally diagnoses that need a person, to a Slack channel.
