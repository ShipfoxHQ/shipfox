# @shipfox/node-docs-client

## 0.1.0

### Minor Changes

- a436d9c: New `@shipfox/node-docs-client` package holds the documentation cache that `@shipfox/api-agent-access` used to own.

  - **Package:** `createDocsCache` reads the docs index, pages, and search. It takes the base URL as a parameter and reads no environment variable.
  - **`@shipfox/api-agent-access`:** takes the cache through its `docs` option and no longer reads `DOCS_BASE_URL`. Without a cache, docs resources and `search_docs` stay off.
  - **`@shipfox/api-server`:** reads `DOCS_BASE_URL`, with the same default as before, and passes one cache to the modules that need it.
