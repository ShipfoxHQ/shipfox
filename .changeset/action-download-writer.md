---
"@shipfox/actions": minor
---

Adds `@shipfox/actions/download-writer`, which writes tool downloads into the job workspace. The runner and the testing helper both use it.

- **Destination:** `resolveDownloadTarget` resolves a destination against the step working directory and creates the directory. The path must stay inside the workspace, and it is checked again after `realpath` so a symlink cannot lead out. A trailing `/` means a directory.
- **Name:** `sanitizeDownloadFilename` strips path separators, control characters, and leading dots from the provider's filename.
- **Write:** `writeDownloadedFile` streams to a hidden `.partial` file while hashing it, enforces the per-file limit and an optional step budget as bytes arrive, and then moves the file into place. In a directory, a taken name gets ` (2)`, ` (3)`, and so on. A file the destination names is replaced. The partial file is removed on any failure.

The contract adds `MAX_DOWNLOAD_FILE_BYTES` (100 MiB) and `MAX_STEP_DOWNLOAD_BYTES` (1 GiB).
