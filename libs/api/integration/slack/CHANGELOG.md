# @shipfox/api-integration-slack

## 5.0.0

### Minor Changes

- 2875241: Adds deduplicated Slack installation revocation for app uninstall and bot token-revocation events.
- fb70438: Cascades provider installation and token deletion when removing a connection.

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-slack-dto@5.0.0
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/api-workspaces@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2

## 4.0.0

### Minor Changes

- 67176d4: Adds the Slack OAuth connection flow with provider routes, secure bot-token storage, and E2E setup.
- 7267872: Adds signed Slack Events API and slash-command receivers that publish normalized integration events without persisting command verification tokens.
- bbba3b7: Adds the Slack integration provider scaffold with installation storage, bot-token custody, and flag-gated registration.

### Patch Changes

- 0745ee9: Prevents Slack bot tokens from being read for revoked, expired, or missing installations.
- 23c8e4d: Rejects Slack OAuth grants that enable unsupported token rotation.
- 1951293: Adds in-process Slack agent tools for reading conversations and acting on messages through the lease-authenticated gateway.
- Updated dependencies [dda7c54]
- Updated dependencies [7267872]
- Updated dependencies [bbba3b7]
  - @shipfox/api-integration-slack-dto@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/api-workspaces@4.0.0
