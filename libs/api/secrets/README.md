# @shipfox/api-secrets

Backend foundation for workspace-scoped secrets and variables.

This package is an internal API module. It owns encrypted secret storage, plaintext
variables, data-key wrapping, and the in-process store API used by other backend
modules.

## Trust Boundary

The in-process store functions do not perform user authorization. Callers must
derive `workspaceId`, `projectId`, and namespace from an already-authorized
request or trusted server workflow before calling this package. Do not pass
attacker-controlled scope values directly into `getSecret`, `setSecrets`,
`getVariable`, or `setVariables`.

Secret values are write-only at the HTTP boundary planned for management routes.
Internal callers can read plaintext secrets only after their own authorization
and tenancy checks have succeeded.
