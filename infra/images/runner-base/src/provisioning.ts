import {fileURLToPath} from 'node:url';

// Complete runner image builds run this OS preparation before their own runner stage, so a
// base-derived image and a complete image share one definition of the operating system.
export const RUNNER_BASE_PREPARE_OS_SCRIPT = fileURLToPath(
  new URL('../scripts/build/prepare-os.sh', import.meta.url),
);
