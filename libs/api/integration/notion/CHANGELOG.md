# @shipfox/api-integration-notion

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
