---
"@shipfox/api-integration-jira": minor
---

Binds each Jira webhook to its integration connection with a delivery token in the callback URL. For webhooks registered after this change, the API rejects a delivery without the matching token, so a valid Jira JWT can't post events to another integration connection. The API still accepts webhooks registered before this change without the token until the renewal sweep registers them again. `JiraInstallation` adds `webhookDeliveryBound`.
