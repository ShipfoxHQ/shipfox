---
"@shipfox/workflow-templates": minor
---

Adds the `fix-default-branch-ci` template. It investigates the first failed push or scheduled GitHub Actions run on the default branch after the workflow last passed. It skips failures while a repair pull request for the same workflow is open.

The agent works in a read-only checkout without saved credentials. It classifies the cause as a regression, flaky test, setup issue, external outage, or unknown. For an actionable cause, it opens a draft repair pull request after the configured checks pass. Repairs over the 30,000-byte delivery limit open no pull request. A separate job pushes the tested patch. External outages produce no writes. The optional `report` role notifies a Slack channel about failures that need a person, repair pull requests, or both.
