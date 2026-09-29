---
"@shipfox/api-runners": minor
"@shipfox/api-runners-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-integration-shipfox-dto": minor
"@shipfox/client-workflows": minor
---

Adds machine placement rules for installation provisioning. A policy can now pass `placement.resolve`, and a job that needs a reserved runner label but only matches refused templates fails within one poll with the new `runner_not_allowed` status reason and its notice. The client shows the notice and its action.
