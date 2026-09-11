# @shipfox/api-agent-access

## 26.0.0

### Minor Changes

- a8ff016: Adds bounded error details, exposes state-changing action tools in tools/list with their destructiveHint, idempotentHint, and openWorldHint annotations, and limits action calls to 10 per credential per minute on top of the existing shared window.

### Patch Changes

- fb73bca: Removes unused OAuth scope fields and carries agent access through workspace membership authority.
- Updated dependencies [a8ff016]
- Updated dependencies [795eee2]
- Updated dependencies [e157b10]
- Updated dependencies [fb73bca]
  - @shipfox/api-agent-access-dto@26.0.0
  - @shipfox/api-logs-dto@26.0.0
  - @shipfox/api-triggers-dto@26.0.0
  - @shipfox/api-auth-context@26.0.0
  - @shipfox/api-auth-dto@26.0.0

## 25.0.0

### Patch Changes

- Updated dependencies [00e2ce4]
- Updated dependencies [bba82ae]
- Updated dependencies [9e8b007]
  - @shipfox/api-workflows-dto@25.0.0
  - @shipfox/api-agent-access-dto@25.0.0
  - @shipfox/api-auth-context@25.0.0

## 24.2.0

### Minor Changes

- 6100626: Adds stable gate failure reasons and restart diagnostics across workflow APIs, Agent Access, and the client.

### Patch Changes

- Updated dependencies [011d9ec]
- Updated dependencies [3cc2ffb]
- Updated dependencies [6100626]
  - @shipfox/api-workflows-dto@24.2.0
  - @shipfox/api-agent-access-dto@24.2.0
  - @shipfox/api-definitions-dto@24.2.0

## 24.1.1

### Patch Changes

- @shipfox/api-definitions-dto@24.1.1
- @shipfox/api-workflows-dto@24.1.1

## 24.1.0

### Minor Changes

- cdc9dfe: Adds the waiting workflow run status to DTO, database, server, and client contracts without producing it during run creation.

### Patch Changes

- Updated dependencies [d559bdb]
- Updated dependencies [c730a68]
- Updated dependencies [34b5267]
- Updated dependencies [cdc9dfe]
  - @shipfox/api-definitions-dto@24.1.0
  - @shipfox/api-agent-access-dto@24.1.0
  - @shipfox/api-logs-dto@24.1.0
  - @shipfox/api-workflows-dto@24.1.0
  - @shipfox/api-auth-context@24.1.0
  - @shipfox/node-error-monitoring@0.3.1
  - @shipfox/node-fastify@0.4.5
  - @shipfox/node-opentelemetry@0.6.6
  - @shipfox/node-module@1.0.11

## 24.0.0

### Patch Changes

- @shipfox/api-definitions-dto@24.0.0
- @shipfox/api-auth-context@24.0.0
- @shipfox/api-workflows-dto@24.0.0

## 23.2.0

### Patch Changes

- @shipfox/api-projects-dto@23.2.0
- @shipfox/api-auth-context@23.2.0

## 23.1.0

### Patch Changes

- @shipfox/api-auth-context@23.1.0

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

### Patch Changes

- Updated dependencies [7fed218]
- Updated dependencies [bd5acd2]
  - @shipfox/api-agent-access-dto@23.0.0
  - @shipfox/api-auth-context@23.0.0
  - @shipfox/api-workflows-dto@23.0.0
  - @shipfox/api-definitions-dto@23.0.0
  - @shipfox/annotations-dto@20.3.0
  - @shipfox/api-logs-dto@20.0.0
  - @shipfox/api-projects-dto@21.0.0
  - @shipfox/api-triggers-dto@22.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.4.4
  - @shipfox/node-module@1.0.10
  - @shipfox/node-opentelemetry@0.6.5

## 22.0.0

### Patch Changes

- 6fd8c7b: Omit absent cursors, attempts, filters, and execution IDs from agent tool requests.
- Updated dependencies [c392dfb]
- Updated dependencies [e390533]
  - @shipfox/api-triggers-dto@22.0.0
  - @shipfox/api-workflows-dto@22.0.0

## 21.2.0

### Minor Changes

- 12cc22e: Adds bounded Agent Access tools for workflow execution trigger-event diagnostics.

### Patch Changes

- Updated dependencies [0745878]
- Updated dependencies [1f2c634]
- Updated dependencies [12cc22e]
- Updated dependencies [8407bd1]
- Updated dependencies [41e1cfc]
  - @shipfox/node-module@1.0.10
  - @shipfox/api-workflows-dto@21.2.0
  - @shipfox/api-agent-access-dto@21.2.0
  - @shipfox/api-triggers-dto@21.2.0
  - @shipfox/api-definitions-dto@21.2.0

## 21.1.0

### Minor Changes

- a0791a3: Adds a `get_step_logs` tool that reads a log tail for one exact workflow step attempt, or the first failed step attempts in a workflow run.
- 661868a: Adds bounded workflow traversal tools to Agent Access.
- 6d94ffc: Preserves structured workflow values in lazy Agent Access diagnostics.

### Patch Changes

- Updated dependencies [a0791a3]
- Updated dependencies [661868a]
- Updated dependencies [01af160]
- Updated dependencies [8a98a87]
- Updated dependencies [6d94ffc]
- Updated dependencies [6fac62f]
  - @shipfox/api-agent-access-dto@21.1.0
  - @shipfox/api-workflows-dto@21.1.0

## 21.0.0

### Minor Changes

- f3df1e5: Add bounded Agent Access trigger-event detail and facet discovery tools.

### Patch Changes

- Updated dependencies [12f7b10]
- Updated dependencies [e225f5e]
- Updated dependencies [879f227]
- Updated dependencies [cffa62d]
- Updated dependencies [5886bf2]
- Updated dependencies [b5d02d1]
- Updated dependencies [32e9fa0]
- Updated dependencies [f3df1e5]
  - @shipfox/api-workflows-dto@21.0.0
  - @shipfox/api-definitions-dto@21.0.0
  - @shipfox/api-projects-dto@21.0.0
  - @shipfox/api-agent-access-dto@21.0.0
  - @shipfox/api-triggers-dto@21.0.0

## 20.4.0

### Minor Changes

- 0b32d1a: Remove personal access token support from agent access.

### Patch Changes

- Updated dependencies [9a66057]
- Updated dependencies [0b32d1a]
  - @shipfox/api-workflows-dto@20.4.0
  - @shipfox/api-auth-context@20.4.0

## 20.3.0

### Minor Changes

- 47f6024: Add bounded paged agent-access tools for project, definition, run, annotation, and trigger-event reads.

### Patch Changes

- Updated dependencies [813a284]
- Updated dependencies [47f6024]
- Updated dependencies [da6fbb8]
  - @shipfox/api-workflows-dto@20.3.0
  - @shipfox/api-agent-access-dto@20.3.0
  - @shipfox/annotations-dto@20.3.0
  - @shipfox/api-definitions-dto@20.3.0

## 20.2.0

### Minor Changes

- ba481d6: Add the dormant agent-access MCP gateway foundation and shared tool response contracts.

### Patch Changes

- Updated dependencies [ba481d6]
  - @shipfox/api-agent-access-dto@20.2.0
  - @shipfox/node-fastify@0.4.4
  - @shipfox/api-auth-context@20.2.0
  - @shipfox/node-module@1.0.9
