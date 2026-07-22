# @shipfox/api-integration-slack-dto

## 8.0.0

### Patch Changes

- Updated dependencies [7f227c6]
  - @shipfox/api-integration-core-dto@8.0.0

## 6.0.0

### Patch Changes

- Updated dependencies [0bb82a4]
- Updated dependencies [f262539]
- Updated dependencies [3bb4e26]
- Updated dependencies [4604a06]
  - @shipfox/api-integration-core-dto@6.0.0

## 5.0.0

### Minor Changes

- 2875241: Adds deduplicated Slack installation revocation for app uninstall and bot token-revocation events.

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core-dto@5.0.0

## 4.0.0

### Patch Changes

- dda7c54: Adds the Slack integration provider contract with OAuth, event, command, and E2E schemas.
- 7267872: Adds signed Slack Events API and slash-command receivers that publish normalized integration events without persisting command verification tokens.
