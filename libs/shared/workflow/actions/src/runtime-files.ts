import {fileURLToPath} from 'node:url';

// The action process runs these with plain `node`, so they always come from dist, even when this
// module loads from src through the workspace-source condition. Both directories sit at the same
// depth, so one relative URL serves both.
export const ACTION_BOOTSTRAP_PATH = fileURLToPath(
  new URL('../dist/bootstrap.js', import.meta.url),
);
export const ACTION_LOADER_PATH = fileURLToPath(new URL('../dist/loader.js', import.meta.url));

/** The process that hashes files for a `hashFiles()` call where the step's files live. */
export const HASH_FILES_CLI_PATH = fileURLToPath(
  new URL('../dist/hash-files-cli.js', import.meta.url),
);
