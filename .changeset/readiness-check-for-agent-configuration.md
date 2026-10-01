---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/api-triggers-dto": minor
"@shipfox/api-triggers": patch
"@shipfox/expression": minor
---

`checkRunReadiness` now reports `agent-config-invalid` for an agent step whose model, provider or thinking level the agent module refuses. It checks only steps whose `model`, `provider` and `thinking` are literal or absent, so a templated value never produces an issue. An absent value falls back to the workspace defaults. The issue blocks the start for a normal job, and fails the job when the job is listening or the session key is filled after run creation. The readiness route returns the new issue with its `reason`, `model` and `provider`. `@shipfox/expression` exports `shouldFillAtSite`.
