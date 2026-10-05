# Shipfox Client Onboarding

Client onboarding for Shipfox workspaces: the pre-project setup gate, the
post-activation Get-started checklist, and its panel and top-bar hosts.

## What it does

- **`loadWorkspaceSetupRoute`**: the existing onboarding gate. It recomputes
  "where should this user be" from live queries on every navigation under
  `/w/$workspaceSlug`: suspended check, then project existence, then usable
  source connections, then model-provider handling, then project creation.
  Once it has seen a project, it remembers that on the device and lets the
  workspace through at once, checking project existence in the background. If
  that check finds no project, it drops the hint and calls `revalidate` to run
  again.
- **`deriveIntegrationReadiness`**: the readiness model shared with the
  first-workflow spec. It turns the provider catalog and the workspace's
  connections into per-provider `connected` and `attention` state, an
  `attentionProviders` list ordered by the most recent connection update, and
  the two workspace-level facts `hasSourceControl` and `hasToolIntegration`.
- **`deriveSetupChecklist`**: the setup-checklist derivation. It turns
  integration readiness plus runner, model-provider, first-workflow, and
  membership facts into the ordered `items` list, the tracked `openCount` and
  `trackedCount`, and `complete`. Rows follow the spec order; the runner and
  model-provider rows exist only when the installation does not already provide
  the capability; the teammates row is a pointer that never counts.
- **`selectNextSetupStep`**: the one row a compact host asks for. It returns the
  first open tracked row, falling back to the first unfinished pointer once
  every tracked row is done.
- **`WorkspaceSetupChecklist`** and **`WorkspaceSetupIndicator`**: slot-ready
  hosts that load the six checklist query families, render the checklist in a
  panel or a non-modal popover, and persist per-device dismissal. The panel sits
  above a page's own content, so it shows only the next step. A header toggle
  opens the full list, and that choice is remembered per device. The popover
  always carries the whole checklist.
- **`FirstWorkflowPanel`**: the first workflow panel. In choose mode it shows
  the MCP setup inline, collapsing to "Connected: <client>" once the signed-in
  user has an agent grant for the workspace. It recommends one workflow
  template in full and lists up to three more on one line each, every one with
  its integration icons and a copyable prompt. Each title links to the
  template's example page in the docs. Templates that need a connection the workspace lacks are
  not shown. In finish mode it links
  the latest succeeded test run and explains which pull request turns the
  workflow on. The template cards move behind a disclosure.
  `WorkspaceSetupChecklist` mounts it below the checklist on the home.
- **`ProjectFirstWorkflowPanel`**: slot-ready host that renders
  `FirstWorkflowPanel` for one project, in place of the project workflows
  page's empty list.

The derivations are pure functions. They test without React and decide what
the checklist shows, while the hosts own query freshness, loading and failure
gating, analytics, completion transitions, and the completion burst.

## Installation and setup

```sh
pnpm add @shipfox/client-onboarding
```

The package is part of the `libs/client` workspace. Its runtime dependencies
are `api-agent-access-dto`, `client-agent`, `client-api`,
`client-integrations`, `client-projects`, `client-runners`, `client-shell`,
`client-workflows`, and `client-workspace-settings`.

## Usage

```tsx
import {
  deriveIntegrationReadiness,
  deriveSetupChecklist,
  FirstWorkflowPanel,
  selectNextSetupStep,
} from '@shipfox/client-onboarding';

const readiness = deriveIntegrationReadiness({
  providers: [
    {provider: 'github', displayName: 'GitHub', capabilities: ['source_control']},
    {provider: 'linear', displayName: 'Linear', capabilities: ['agent_tools']},
  ],
  connections: [],
});

const checklist = deriveSetupChecklist({
  readiness,
  installationRunners: 'none',
  workspaceRunnerCapacity: false,
  modelProvider: {installationProvided: false, configured: false},
  membership: {memberCount: 1, pendingInvitationCount: 0},
  firstWorkflow: {state: 'open'},
});

checklist.items; // 7 rows: source control, project, tools, runner,
// model provider, first workflow, teammates
checklist.trackedCount; // 6
checklist.openCount; // 4
checklist.complete; // false

selectNextSetupStep(checklist)?.id; // 'tools'

// Render inside the application's TanStack Router and React Query contexts.
// `surface` is reported with the panel's analytics events.
<FirstWorkflowPanel
  workspace={{id: 'workspace-id', slug: 'acme'}}
  progress={{state: 'open'}}
  surface="workflows_empty"
/>;
```

The rendered hosts can be exported through the package feature entry point for
shell slot composition:

```ts
import {
  ProjectFirstWorkflowPanel,
  WorkspaceSetupChecklist,
  WorkspaceSetupIndicator,
} from '@shipfox/client-onboarding/feature';
```

The caller maps its own query results to the derivation inputs:

- `providers` and `connections` use the plain values from
  `@shipfox/client-integrations`.
- `installationRunners` is `'managed'` or `'none'`.
- `workspaceRunnerCapacity` reports whether the workspace has runner capacity.
- `modelProvider` reports installation-provided inference and workspace
  configuration.
- `membership` reports the member and pending-invitation counts.
- `firstWorkflow` is `{state: 'open'}`, `{state: 'test_run_succeeded',
  testRunId}`, or `{state: 'done'}`.

## Behavior notes

- A provider is `connected` when at least one connection is `active`; it needs
  `attention` when connections exist but none is active. The two states are
  mutually exclusive.
- `hasToolIntegration` is the tools-row criterion: an active connection whose
  provider lacks the `source_control` capability. GitHub never satisfies it.
- The tools row names one attention provider ("Linear needs attention") or
  counts several ("2 integrations need attention").
- `complete` is true when every tracked row is done. Tracked rows are source
  control, project, tools, and first workflow, plus runner and model-provider
  when those rows exist. The teammates pointer never counts.
- The first-workflow row is open with "Create your first workflow" and a link
  to the workspace home until a dev run succeeds. It then reads "A test run
  succeeded" and links to that run. It is done once the workspace has a
  definition. A succeeded dev run is the only fact behind the middle state.
- The hosts read the first-workflow state per project: definitions and
  succeeded dev runs, one of each, stopping at the first definition. The read
  reloads when the window regains focus and polls every 15 seconds while the
  tab is visible, until the row is done. The other families never poll.
- The runner row exists only when `installationRunners` is `'none'`; the
  model-provider row exists only when `modelProvider.installationProvided` is
  false.
- The teammates row renders done at `memberCount >= 2` or
  `pendingInvitationCount >= 1`, but stays a pointer.
- The panel and indicator render nothing while their queries load, so a
  workspace that finished setup never sees a placeholder. The slots exported
  from `./feature` load lazily behind their own hidden Suspense boundary.
- The panel and indicator render nothing for an initially complete checklist;
  the mounted host that observes the final tracked row transition renders the
  completion state and owns its one-shot burst.
- The panel also observes the first-workflow row turning done. It captures
  `first_workflow_activated` and plays a burst above the next step. When the
  same transition completes the checklist, only the completion burst plays.
- Both hosts capture `first_workflow_test_run_shown` once per mount, the first
  time they show the row as "A test run succeeded".
- The panel host renders `FirstWorkflowPanel` below the checklist when runners
  are available (installation-managed or workspace capacity), a model is
  available (installation-provided or configured), and the workspace has no
  definition. It reads these facts from their queries, not from row
  visibility, and renders no panel while the runner or model family is
  loading or failed. It does not wait for the tools row, so a GitHub-only
  workspace sees the panel while "Connect your tools" is the next step. A
  dismissed checklist hides the panel too.
- `ProjectFirstWorkflowPanel` reads the definitions and succeeded dev runs of
  its project only, so a definition or a test run in another project never
  changes its mode or run link. It ignores the checklist's dismissal and polls
  only while mounted. The workflows page shows it in place of the empty list,
  so it shows a skeleton while its progress loads and falls back to choose
  mode if that read fails. Once the project has a definition, it renders nothing and refreshes
  the project's definitions list, which does not poll.
- The panel reads `GET /workspaces/:workspaceId/workflow-templates`, which
  returns templates grouped and ranked for the workspace's connections. The
  recommended template and the list come from the `try_now` and
  `starts_on_event` groups in that order; the `needs_connection` group is not
  shown.
- `FirstWorkflowPanel` captures `first_workflow_panel_opened` with `surface`
  and `mode` once per mode it shows, and `first_workflow_prompt_copied` with
  `surface`, `template_id` (or `generic`), and `group` for a template after a
  successful copy.
- Dismissal is scoped to the workspace and device. A dismissed host does not
  subscribe to checklist queries until the flag is cleared.

## Development

```sh
turbo check --filter=@shipfox/client-onboarding
turbo type --filter=@shipfox/client-onboarding
turbo test --filter=@shipfox/client-onboarding
turbo build --filter=@shipfox/client-onboarding
```

The package runs Storybook per the per-package recipe (`pnpm storybook` on
port 6015) with stories covering both hosts and each checklist state.

## License

MIT
