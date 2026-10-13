---
"@shipfox/actions": minor
---

Every action gets `ctx.cache` to save files in a job and restore them in a later job of the same project.

- **SDK:** `cache.hashFiles(patterns)`, `cache.restore(options)`, and `cache.save(options)`. Paths anchor to the step working directory, the home directory, or `/`, so an entry restores into a job with another checkout path or home. Files are archived as zstd-compressed `tar` segments in the action process and moved to object storage in parallel parts and ranges, with retries per part. A miss, a full workspace, or a storage failure logs a warning and resolves. A failure while writing files throws `CacheExtractionError`.
- **Contract:** the local endpoint serves `/v1/cache/restore`, `/v1/cache/entries`, `/v1/cache/entries/commit`, `/v1/cache/entries/abort`, and `/v1/cache/entries/check`, and the runner sets `SHIPFOX_TEMP`. Both are additive, so the contract stays `v1`.
- **Testing:** `createCacheFake()` in `@shipfox/actions/testing`, and a `cache` option on `runAction`.
