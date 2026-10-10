# @shipfox/api-integration-posthog

## 34.0.0

### Patch Changes

- 462cc7c: Fixes every call to the `survey-stats` tool failing with an unknown `date-time` format. The date fields keep their ISO timestamp pattern.
- bbc57ef: Returns PostHog tool results as JSON to tool steps, so a step can map fields of the result. Agent steps keep the compact text.
- Updated dependencies [16d18f4]
- Updated dependencies [c4f486b]
- Updated dependencies [2d009f4]
- Updated dependencies [c06262b]
- Updated dependencies [c8e0869]
- Updated dependencies [21c993b]
- Updated dependencies [1d94e37]
- Updated dependencies [e2e561c]
- Updated dependencies [7d9b08a]
- Updated dependencies [82f2480]
- Updated dependencies [89a6cc7]
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/api-integration-spi@4.4.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/api-integration-posthog-dto@34.0.0
  - @shipfox/node-drizzle@0.3.7

## 32.2.0

### Patch Changes

- c021e83: Fixes PostHog setup and key replacement for project-scoped personal API keys.
  Checks required read scopes and shows actionable errors for integration connection failures.

## 31.0.0

### Patch Changes

- 6ac3480: Adds PostHog project connections and read-only SQL agent tools, with reliable tool error recovery.
- Updated dependencies [6ac3480]
  - @shipfox/api-integration-posthog-dto@31.0.0
  - @shipfox/api-integration-spi@4.3.3

## 30.0.0

### Minor Changes

- c647dea: Adds validated PostHog project connections and explicit API key replacement.
- 5e2111a: Adds read-only PostHog MCP agent tools.

### Patch Changes

- Updated dependencies [c647dea]
- Updated dependencies [0d3c668]
  - @shipfox/api-integration-posthog-dto@30.0.0
  - @shipfox/api-integration-spi@4.3.2

## 29.1.0

### Minor Changes

- 61bf190: Adds the flag-gated PostHog provider, off by default, region-aware API-key and project-selection connect contracts, and an E2E connection-seeding helper.

### Patch Changes

- Updated dependencies [61bf190]
  - @shipfox/api-integration-posthog-dto@29.1.0
