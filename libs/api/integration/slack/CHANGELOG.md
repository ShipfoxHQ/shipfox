# @shipfox/api-integration-slack

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
