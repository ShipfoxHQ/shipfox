---
"@shipfox/api-workspaces": minor
"@shipfox/api-workspaces-dto": minor
"@shipfox/api-auth": minor
"@shipfox/api-auth-context": minor
---

Exposes the workspace slug to server modules. The workspace summary now returns the slug, and each membership in the user token carries an optional `workspaceSlug` claim. Tokens issued before this release stay valid without the claim.
