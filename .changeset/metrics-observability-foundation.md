---
"@shipfox/node-module": patch
"@shipfox/api-runners": patch
---

Add the foundation for metrics observability. `@shipfox/node-module` gains an optional `metrics` hook on `ShipfoxModule` plus `registerModuleMetrics`, a declarative slot for modules to register service-level metrics (observable gauges) once at app startup, kept separate from `initializeModules` so unit tests never bind the metrics port. `@shipfox/api-runners` is instrumented as the worked example across both planes: instance counters for job enqueue, claim, and lease expiry recorded inline, and `runners_pending_jobs` / `runners_running_jobs` observable gauges over a new `getJobQueueDepth` query wired through the module hook.
