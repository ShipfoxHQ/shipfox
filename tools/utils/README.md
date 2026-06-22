# @shipfox/tool-utils

Small utilities shared by Shipfox CLI tools for path resolution, shell command building, and logging. It should be used with other packages from [Shipfox](https://www.shipfox.io/).

## What it does

- **Path helpers**: Resolve project root, workspace root, binary paths, and file paths within the monorepo.
- **Shell helpers**: Build properly quoted and escaped shell commands cross-platform.
- **`log`**: Structured logging (`info`, `warning`, `error`, `debug`) via `@actions/core`.

## Installation

```bash
pnpm add -D @shipfox/tool-utils
```

## Usage

```ts
import {
  getProjectRootPath,
  getWorkspaceRootPath,
  getProjectBinaryPath,
  buildShellCommand,
  log,
} from "@shipfox/tool-utils";

const projectRoot = getProjectRootPath(import.meta.url);
const workspaceRoot = getWorkspaceRootPath();
const swcBin = getProjectBinaryPath("swc", import.meta.url);

const cmd = buildShellCommand([swcBin, "-d", "dist", "src"]);

log.info("Build started");
```
