---
"@shipfox/client-workflows": minor
---

Shows concurrent steps on the run page.

- **Markers:** a member of a `parallel` block is marked "parallel", and any other background step "background", in muted text beside the step name. A block's wait row comes right after its members. Wait and cancel rows get their own icons, and a wait row's duration is how long it blocked. A cancelled step whose process has not stopped yet shows "Cancelling", and its log stays live.
- **Several running steps:** the page opens on, and the "Jump to it" notice points at, the latest running step the job waits on, or the earliest running background step when only background steps run. Wait rows and stopping steps are never that target. The notice stays hidden while any step it could point at is open.
