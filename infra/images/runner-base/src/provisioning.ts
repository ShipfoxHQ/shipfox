import {fileURLToPath} from 'node:url';

// Complete runner image builds run this OS preparation before their own runner stage, so a
// base-derived image and a complete image share one definition of the operating system.
export const RUNNER_BASE_PREPARE_OS_SCRIPT = fileURLToPath(
  new URL('../scripts/build/prepare-os.sh', import.meta.url),
);

// Bases install the latest release of the pinned Node major with this script. Complete builds and
// base-derived candidates run it again: it downloads Node only when that major is missing.
export const RUNNER_BASE_INSTALL_NODE_SCRIPT = fileURLToPath(
  new URL('../scripts/build/install-node.sh', import.meta.url),
);
