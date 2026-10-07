---
"@shipfox/api-projects-dto": minor
"@shipfox/api-projects": patch
"@shipfox/api-workflows": patch
---

A checkout-token refusal for an explicit `checkout.project` names the repository. `resolveCheckoutTarget` returns the project's `sourceRepositoryOwner` and `sourceRepositoryName`, and the refusal message and `details.repository` use them.
