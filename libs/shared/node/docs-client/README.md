# Shipfox Docs Client

Reads the Shipfox documentation site for the API: its page index, single pages, and search.

## What it does

- **`createDocsCache({baseUrl, fetch?, now?, setInterval?})`**: Creates a cache over the docs site. It reads `llms.txt` for the page index, `mcp.mdx/<slug>` for pages, and `api/search` for search.
- **`DocsCache`**: `enabled`, `start()`, `readIndex()`, `readPage(slug)`, `hasSlug(slug)`, `isIndexCached()`, `isPageCached(slug)`, and `search(query)`.
- **`docsBaseUrl(value)`**: Validates a docs base URL and returns it with a trailing slash, or `undefined` for an empty value.
- **`isValidDocsSlug(slug)`**: Checks that a slug is a page slug and not a reserved name.
- **`DocsUnavailableError`**: Thrown when the docs site can't answer and no cached copy exists.
- **`DOCS_INDEX_URI`**, **`DOCS_TEMPLATE_URI`**: The `docs://shipfox/` resource URIs.

## Installation and setup

```sh
pnpm add @shipfox/node-docs-client
```

The package reads no environment variable. The host passes the base URL.

## Usage

```ts
import {createDocsCache} from '@shipfox/node-docs-client';

const docs = createDocsCache({baseUrl: 'https://www.shipfox.io/docs'});
docs.start();

if (docs.enabled) {
  const hits = await docs.search('workflow triggers');
}
```

## Behavior notes

- **An empty base URL disables the cache.** `enabled` is `false`, and every read rejects with `DocsUnavailableError`.
- **An invalid base URL throws.** The URL must be absolute HTTP or HTTPS, with no credentials, query, or fragment.
- **Cached content survives an outage.** The index refreshes every 15 minutes and pages after one hour, both with `ETag` revalidation. A failed refresh keeps the previous copy.
- **Search returns at most five hits.** Only pages in the index count.

## Development

```sh
turbo check --filter=@shipfox/node-docs-client
turbo type --filter=@shipfox/node-docs-client
turbo test --filter=@shipfox/node-docs-client
```

## License

MIT
