---
'@shipfox/client-secrets': minor
---

Opens the create modal on the variables and secrets settings pages when the URL carries `?create=KEY`. The name field is filled in with the key, and closing the modal removes the parameter. A key that is not a valid variable or secret name is ignored. `WorkspaceVariablesSection` and `WorkspaceSecretsSection` accept `createKey` and `onCreateKeyClear`.
