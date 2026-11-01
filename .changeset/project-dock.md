---
"@shipfox/client-shell": minor
---

Add a `projectDock` feature contribution, so a feature can host a panel beside every project page.

- **`ClientFeature`:** gains `projectDock`, whose `load` returns a dynamic import. A second contribution fails composition.
- **`/runtime`:** exports `ProjectDockPanel`, `useProjectDock()`, `useShippyPlacement()`, `useAgentPageContext()`, and `useCurrentAgentPageContext()`.
- **`Shippy`:** gains the `body` and `face` poses.
- **Toasts:** the shell's `Toaster` moves to the bottom-left.
