---
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-github": patch
"@shipfox/api-workflows": patch
"@shipfox/api-agent-access": patch
---

Names the cause of a checkout failure. Each refusal now identifies the repository, connection or project it was about, a suspended or removed GitHub App installation has its own `installation-inactive` code, and GitHub's own explanation reaches the step error as `provider_message` and `provider_status`. A missing repository now returns a 422, and a failed token mint is cached for 60 seconds instead of 15 minutes.
