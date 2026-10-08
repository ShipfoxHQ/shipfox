---
"@shipfox/api-projects-dto": minor
"@shipfox/api-projects": patch
"@shipfox/api-workflows": patch
---

A checkout-token refusal for an explicit `checkout.project` names the repository when the project has a source owner and name. `resolveCheckoutTarget` returns both as `sourceRepositoryOwner` and `sourceRepositoryName`.
