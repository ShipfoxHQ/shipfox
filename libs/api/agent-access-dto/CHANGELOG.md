# @shipfox/api-agent-access-dto

## 23.0.0

### Major Changes

- 7fed218: Activates Agent Access OAuth, MCP tools, and settings in the default application composition.

  `API_PUBLIC_URL` is required. Set it to the externally reachable API origin
  before startup. Local development may use `http://localhost:16101`; staging and
  production must use HTTPS.

  The `apiPublicUrl` option of `createAgentAccessRoutes` and
  `createAgentAccessModule` now accepts only a bare HTTPS origin or a loopback
  HTTP origin. Construction rejects paths, queries, fragments, credentials,
  surrounding whitespace, control characters, and non-loopback HTTP origins.

  OAuth consent responses now distinguish CIMD identities from self-registered
  clients. API DTO consumers must use `client_identity_kind`;
  `client_identity_origin` is an origin for CIMD clients and `null` for
  self-registered clients. In `@shipfox/client-agent`, `OAuthConsent` replaces
  `clientIdentityOrigin` with the `clientIdentity` discriminated union; use
  `clientIdentity.kind` and, for CIMD identities, `clientIdentity.origin`.

  Applications that previously appended `createOAuthRoutes`,
  `createOAuthAuthorizationRoutes`, or `createAgentAccessManagementRoutes` to
  `createAuthModule().routes` must remove those manual route groups. The standard
  module composition now registers them, and composing them twice causes duplicate
  Fastify route registration.

  Applications that replace the standard Auth module with `authModuleFactory`
  must register `AUTH_AGENT_ACCESS`. Include the `createAgentAccessAuthMethod`
  export from `@shipfox/api-auth` in the replacement module's auth methods so the
  default MCP route can authenticate agent-access credentials.

  After deployment, fetch
  `$API_PUBLIC_URL/.well-known/oauth-authorization-server` and verify that its
  issuer and endpoint origins match `API_PUBLIC_URL`.

### Minor Changes

- bd5acd2: Bounds listener filter snapshots to referenced context paths and a separate 512 KiB `filter_snapshot` execution payload limit.

### Patch Changes

- @shipfox/api-logs-dto@20.0.0

## 21.2.0

### Minor Changes

- 12cc22e: Adds bounded Agent Access tools for workflow execution trigger-event diagnostics.

### Patch Changes

- 8407bd1: Rejects oversized listener fire deliveries without suppressing matching resolve events.
- 41e1cfc: Surfaces precise, safe trigger event errors in the event detail callout.

## 21.1.0

### Minor Changes

- a0791a3: Adds a `get_step_logs` tool that reads a log tail for one exact workflow step attempt, or the first failed step attempts in a workflow run.
- 661868a: Adds bounded workflow traversal tools to Agent Access.
- 6d94ffc: Preserves structured workflow values in lazy Agent Access diagnostics.

## 21.0.0

### Minor Changes

- f3df1e5: Add bounded Agent Access trigger-event detail and facet discovery tools.

## 20.3.0

### Minor Changes

- 47f6024: Add bounded paged agent-access tools for project, definition, run, annotation, and trigger-event reads.

## 20.2.0

### Minor Changes

- ba481d6: Add the dormant agent-access MCP gateway foundation and shared tool response contracts.
