# Shipfox API Cache DTO

Cache DTOs define the HTTP schemas of the routes a runner calls to save and restore a job cache.

## What it does

- **Limits**: `CACHE_KEY_MAX_LENGTH`, `CACHE_SCOPE_MAX_LENGTH`, `CACHE_RESTORE_KEYS_MAX`, `CACHE_FALLBACK_SCOPES_MAX`, `CACHE_PART_SIZE_BYTES`, and `CACHE_MAX_PARTS` bound the request fields and the multipart upload.
- **Field schemas**: `cacheScopeSchema`, `cacheKeySchema`, and `cacheVersionSchema` describe the identity of an entry.
- **Restore**: `cacheRestoreBodySchema` and `cacheRestoreResponseSchema` describe the lookup and its hit.
- **Save**: `cacheReserveBodySchema`, `cacheReserveResponseSchema`, `cacheCommitBodySchema`, and `cacheCommitResponseSchema` describe reserve and commit.
- **Check**: `cacheCheckBodySchema` and `cacheCheckResponseSchema` describe the existence check.

## Installation and setup

```sh
pnpm add @shipfox/api-cache-dto
```

## Usage

Validate a restore request before sending it.

```ts
import {cacheRestoreBodySchema} from '@shipfox/api-cache-dto';

const body = cacheRestoreBodySchema.parse({
  scope: 'default',
  key: 'pnpm-9f2c',
  restore_keys: ['pnpm-'],
  version: 'a1b2c3d4',
});
console.log(body.fallback_scopes);
```

## Behavior notes

- **Scopes:** A scope uses letters, digits, and `. _ - /`. The `dev/` prefix is reserved for dev-run sandboxes. The API rejects it with `reserved-scope`, not the schema.
- **Reserve results:** A reserve answers `reserved` with one signed PUT URL per part in part order, or `exists`, `in_progress`, or `too_large`. Every part except the last has `part_size` bytes.
- **Restore hit:** `scope` is the scope the author wrote, even when the entry came from a dev sandbox. `url` accepts `Range` headers.

## Development

```sh
turbo check --filter=@shipfox/api-cache-dto
turbo type --filter=@shipfox/api-cache-dto
turbo test --filter=@shipfox/api-cache-dto
```

## License

MIT
