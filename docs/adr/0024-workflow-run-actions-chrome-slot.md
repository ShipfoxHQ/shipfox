# ADR 0024: Workflow run actions chrome slot

- **Status:** Accepted.
- **Date:** 2026-10-16.
- **Decision owners:** Client composition maintainers.
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md).

## Context

Cloud adds an action that asks Shipfox AI to improve the workflow behind a run. It renders through `HeaderActions` ([ADR 0020](0020-header-actions-chrome-slot.md)), far from the run's own actions. It reads the run from the route to hide itself on every other page.

`WorkflowRunSummary` owns the run page's actions and has no extension point.

## Decision

`ChromeSlots` exposes an optional `WorkflowRunActions` component that receives `workflowRunId` and `projectId`. `WorkflowRunSummary` renders it through the shell's `WorkflowRunActionsSlot`, before the run's cancel or re-run action. The component may return `null` or a fragment with several actions.

The slot renders inside a reporting error boundary whose fallback is empty. The boundary retries on the next navigation, as the header slot does. `defaultChrome` does not provide the slot, and the summary renders no extra markup without it.

The slot renders on every attempt of a run, including a superseded attempt that hides the run's own actions. A composed action concerns the run's workflow, not the selected attempt.

The title row wraps instead of switching layout at a fixed width. A composed action of any width moves the actions below the title rather than clipping them.

## Consequences

- Composing applications place run actions beside the run's own actions without reading the route.
- A failing run action reports an error without interrupting the run page.
- Existing compositions and self-hosted builds keep their current run page.
- `ChromeSlots` names a run-page concept, like `FirstWorkflowPanel` names a project-page concept.

## Rejected alternatives

### Pass the run read model or the selected attempt

The ids are enough for Cloud, which resolves the workflow itself. A small contract stays stable when the run DTO changes. A later change can add attempt or status props without breaking consumers.

### Declare the props in `@shipfox/client-workflows`

`ChromeSlots` must name the props of each slot, and the shell cannot depend on a feature package. Rendering the slot from the feature package would also require exporting `ReportErrorBoundary` or a generic boundary helper from the shell for one call site.

### Keep using `HeaderActions`

The header is far from the run's actions, and each composed action would repeat the route reading.
