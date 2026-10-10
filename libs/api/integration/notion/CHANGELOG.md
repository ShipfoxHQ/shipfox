# @shipfox/api-integration-notion

## 34.0.0

### Patch Changes

- 5cebae9: Sends Notion the Markdown body its page content endpoint accepts, so `update_page` can replace or append page content. Before, Notion rejected every content update.
- Updated dependencies [16d18f4]
- Updated dependencies [c4f486b]
- Updated dependencies [2d009f4]
- Updated dependencies [4273dad]
- Updated dependencies [c06262b]
- Updated dependencies [c8e0869]
- Updated dependencies [21c993b]
- Updated dependencies [1d94e37]
- Updated dependencies [c06262b]
- Updated dependencies [e2e561c]
- Updated dependencies [9485c57]
- Updated dependencies [7d9b08a]
- Updated dependencies [82f2480]
- Updated dependencies [89a6cc7]
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/api-integration-core-dto@34.0.0
  - @shipfox/api-integration-spi@4.4.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/api-workspaces-dto@34.0.0
  - @shipfox/api-integration-notion-dto@34.0.0
  - @shipfox/node-drizzle@0.3.7

## 33.1.0

### Patch Changes

- 6b0c18d: Accept additional Notion response fields in agent tool results.

## 31.0.0

### Minor Changes

- e9a13b2: Adds Notion OAuth installation and lock-serialized grant replacement with signed state and failure compensation.
- 752b77a: Add Notion page creation, page updates, and comments as write-capable agent tools.

### Patch Changes

- Updated dependencies [da1114b]
- Updated dependencies [e9a13b2]
  - @shipfox/api-integration-core-dto@31.0.0
  - @shipfox/api-integration-notion-dto@31.0.0
  - @shipfox/api-integration-spi@4.3.3

## 30.0.0

### Minor Changes

- ad7aeaf: Adds Notion REST read tools for searching pages, reading page content, querying data sources, and listing comments.
- 22aa322: Adds rotating Notion token refresh, cross-replica grant locking, and best-effort token revocation.
- 0d3c668: Add signed Notion webhook ingestion with one-time verification-token logging, connection-scoped replay protection, grant visibility checks, and event publication.

### Patch Changes

- Updated dependencies [f05d344]
- Updated dependencies [0d3c668]
  - @shipfox/api-integration-core-dto@30.0.0
  - @shipfox/api-integration-notion-dto@30.0.0
  - @shipfox/api-integration-spi@4.3.2
