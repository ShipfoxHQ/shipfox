# @shipfox/node-process-state

## 0.1.0

### Minor Changes

- 2128c1e: Two installed copies of `@shipfox/node-temporal` now share one Temporal client and one runtime install. The new `@shipfox/node-process-state` package keeps process state in versioned `globalThis` slots (`processState(key, init, import.meta.url)`) and records which package copy asked for each slot.

  `initializeModules` logs one warning for every package that keeps its state in `processState` slots and is installed more than once, with its install folders and whether the copies share state. Set `SHIPFOX_STRICT_PACKAGE_COPIES=true` to fail startup when the copies of a package do not share state. It defaults to `false`.
