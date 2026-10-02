---
'@shipfox/client-workflows': minor
---

Adds a Needs setup tag to workflows on the Workflows page when the readiness check finds missing variables or secrets. The tag is warning-toned when an issue stops the run from starting. Run stays available, and the check is refreshed on every page visit, window focus, refused start and finished sync.
