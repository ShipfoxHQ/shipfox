---
"@shipfox/api-agent-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/client-workflows": minor
---

Lets a managed model provider refuse a model for one workspace at run time. A provider opts in by implementing `availability`, which returns the workspace's locked models. A locked model fails the step with a 422 `agent-model-unavailable` response and a policy notice. An error from `availability` returns a retryable 503. Credential renewal doesn't recheck, so a running step is never cut off. The stored step error carries the notice, and the model unavailable callout shows its message and required action. Providers without `availability` behave as before.
