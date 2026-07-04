---
"@shipfox/api-runners": patch
---

Removes the per-request workspace existence and status check from provisioner token auth, severing the last `@shipfox/api-workspaces` dependency in `@shipfox/api-runners`; workspace-status enforcement on the provisioner path moves to the upcoming workspace removal/disable work.
