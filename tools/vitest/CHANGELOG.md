# @shipfox/vitest

## 1.2.3

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [9038afb]
  - @shipfox/tool-utils@1.2.0

## 1.2.2

### Patch Changes

- 166d90b: Adds an environment-controlled Vitest worker cap to reduce CI CPU contention.
- c73370c: Disables Rolldown plugin timing warnings in shared Vitest dependency optimization config.
- c93fa59: Lets package Vitest configs override the shared CI worker cap so small suites can default to one worker while heavier suites keep targeted parallelism.

## 1.2.1

### Patch Changes

- 2311e15: Moves the @shipfox tools packages to a dedicated repository — future versions will be published from there.
- Updated dependencies [2311e15]
  - @shipfox/tool-utils@1.1.3

## 1.2.0

### Minor Changes

- 3a95f26: Add Argos CI Upload Screenshots
- 35f3c64: Add CSS bundle

## 1.1.3

### Patch Changes

- ae8fd17: Export dditional type hints for vitest

## 1.1.2

### Patch Changes

- 674ecbb: Add README for all packages
- Updated dependencies [674ecbb]
  - @shipfox/tool-utils@1.1.2

## 1.1.1

### Patch Changes

- f8c8018: Handle spaces in paths
- 9bd640b: Modify repository structure
- Updated dependencies [9bd640b]
  - @shipfox/tool-utils@1.1.1

## 1.1.0

### Minor Changes

- bdf8ff5: Move libs in open source repo

### Patch Changes

- Updated dependencies [bdf8ff5]
  - @shipfox/tool-utils@1.1.0

## 1.0.2

### Patch Changes

- 7bb1804: Remove unsued publishing scripts
- Updated dependencies [7bb1804]
  - @shipfox/tool-utils@1.0.1

## 1.0.1

### Patch Changes

- 4f1e0d5: Make tools utils a direct prod dependency

## 1.0.0

### Major Changes

- 5688c3e: Initial public release of tools

### Patch Changes

- a6ebd5c: Add MIT license to packages
