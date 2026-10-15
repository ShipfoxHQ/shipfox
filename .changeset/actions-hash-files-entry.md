---
"@shipfox/actions": minor
---

Adds `@shipfox/actions/hash-files`, so the runner hashes files with the same code as `cache.hashFiles`.

- **`hashFiles({patterns, directories, limits, signal})`** resolves with `{hash, files}`. `directories` needs `cwd`, and `home` and `root` are optional. A pattern under a missing anchor throws `CacheArgumentError`.
- **Limits:** with `limits` (`{maxFiles, maxBytes}`), more matched files or more bytes read throws `HashFilesLimitError`, whose `limit` is `files` or `bytes`. `HASH_FILES_RUNNER_LIMITS` is 10,000 files and 1 GiB.
- **No match** throws `HashFilesNoMatchError`, which extends `CacheArgumentError` and keeps the message.
- **Separators:** on Windows, matched paths now use `/` before they are sorted and hashed, so a `key_files` or `cache.hashFiles` key that matched a nested file changes once there. Hashes on Linux and macOS are unchanged, and `\` stays a name character.
- **Hashing process:** `runHashFilesRequest` answers a `{patterns, cwd, limits}` request with `{ok, hash, files}` or a failure the author can fix (`no-match`, `limit`, or `invalid`), and `parseHashFilesResponse` reads the answer. `HASH_FILES_CLI_PATH` from `@shipfox/actions/runtime-files` runs it as a process, so the runner hashes inside a job container.
