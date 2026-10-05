---
"@shipfox/client-shell": minor
"@shipfox/client-onboarding": patch
---

Removes loading phases from client startup. The shell enters the cookie session a declining boot restorer already read instead of refreshing a second time, and `WorkspaceSetupRouteOptions` gains an optional `revalidate` callback that re-runs the workspace setup gate. The onboarding gate lets a workspace that had a project on this device through at once and checks project existence in the background. The lazy onboarding chrome slots load behind their own hidden Suspense boundary, and the setup checklist panel renders nothing until it has loaded and has a step to show.
