---
"@shipfox/api-agent-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/client-workflows": minor
---

Lets a managed model provider refuse a model for one workspace at run time. A provider can now implement `availability`, which returns the locked models for a workspace. The agent module checks it before the first credentials request of a step attempt. It skips the check on credential renewal, so a running step is never cut off. A locked model fails the step with a 422 `agent-model-unavailable` response and a policy notice. A provider error from `availability` returns a retryable 503. Providers without `availability` behave as before. The step error carries the notice, and the model unavailable callout shows its message and required action.
