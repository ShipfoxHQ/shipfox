---
"@shipfox/api-integration-core-dto": major
"@shipfox/api-integration-github-dto": major
"@shipfox/api-integration-jira-dto": major
"@shipfox/api-integration-linear-dto": major
"@shipfox/api-integration-clickup-dto": major
"@shipfox/api-integration-slack-dto": major
"@shipfox/api-integration-sentry-dto": major
"@shipfox/api-integration-webhook-dto": major
"@shipfox/api-integration-gitea-dto": major
"@shipfox/api-integration-notion-dto": major
---

Group integration event catalogs into families that carry the payload kind, a JSON Schema of normalized payloads, and family notes. Event entries now reference their family and no longer carry `emittedWhen` or `payloadKind`. Sentry and custom webhook DTOs export the Zod schema of the normalized `event` value.
