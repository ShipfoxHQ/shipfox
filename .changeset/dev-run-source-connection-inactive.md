---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": patch
"@shipfox/api-triggers": minor
"@shipfox/client-workflows": patch
---

A dev run on an inactive source connection says so instead of suggesting a transient failure.

- **Definitions:** the `source-unavailable` known error of `resolveDefinitionAtRef`, `validateDefinitionAtRef`, and `listDefinitionsAtRef` carries an optional `reason: 'connection-inactive'`.
- **Dev runs:** `POST /dev-runs` returns that reason in the `details` of its `source-unavailable` response.
- **Client:** `devRunErrorCopy` reads "The project's source connection is unavailable" for that reason.
