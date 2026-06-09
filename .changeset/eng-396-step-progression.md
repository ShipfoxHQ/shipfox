---
"@shipfox/api-workflows": patch
---

Add the per-step progression domain service (`nextStepForJob`, `recordStepResult`) and its guarded DB primitives over the existing `steps` table. Dormant until the per-step runner protocol is wired into the HTTP and orchestration layers; no runtime behavior changes yet.
