---
'@shipfox/actions': patch
---

Adds a strict loader mode for registry actions. When the runner sets `SHIPFOX_ACTION_ORIGIN=registry`, a bare import other than `@shipfox/actions*` or a Node built-in fails with `ERR_SHIPFOX_REGISTRY_ACTION_IMPORT`.
