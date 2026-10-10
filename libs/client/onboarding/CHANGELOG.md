# @shipfox/client-onboarding

## 53.0.0

### Major Changes

- bea7e50: The workspace home now shows one onboarding panel at a time. A new workspace sees the tools step first: a provider grid on the home, with "Skip for now" or "Continue". The first-workflow panel shows only after that button is pressed, and the home waits for the first-workflow read before it renders anything. A workspace that skipped the tools step, or that already has a test run or a workflow, no longer counts the tools row toward completion.

  Breaking: `deriveSetupChecklist` requires `toolsStepFinished` and accepts an undefined `firstWorkflow`. The compact panel toggle reads "Show all steps". The panel captures `onboarding_tools_step_finished` with `outcome` and `connected_count`.

### Minor Changes

- 2021ae8: The project workflows page shows the first workflow panel when the project has no workflow.

  - **`@shipfox/client-shell`:** `ChromeSlots` gains an optional `FirstWorkflowPanel` slot that receives `projectId`.
  - **`@shipfox/client-workflows`:** `ProjectWorkflowsPage` renders the slot in place of the empty definitions list once definitions have loaded, the project has none, and sync is neither pending nor running. Without the slot, the page keeps its empty list. When the project has no definitions, a sync that failed only because the repository has no workflow files no longer shows the "Workflow sync failed" callout; the empty state already says so.
  - **`@shipfox/client-onboarding`:** exports `ProjectFirstWorkflowPanel`, also from `/feature` as a lazy component. It reads the progress of that project only, so a definition or a test run in another project never changes it, and it ignores the checklist's dismissal. It shows a skeleton while that progress loads and falls back to choose mode if the read fails. Once the project has a definition, it renders nothing and refreshes the project's definitions list.
  - **`@shipfox/client-features`:** the default project workflows page shows the first workflow panel when the project has no workflow.

- 853a185: Show suggested workflow templates and the inline MCP setup in `FirstWorkflowPanel`, with a finish mode once a test run succeeds. `FirstWorkflowPanel` now takes `progress` and `surface`. `WorkspaceSetupChecklist` renders it below the checklist when runners and a model are available and the workspace has no definition.
- c481dab: The Get-started checklist tracks the first workflow, from a test run to the first synced definition.

  - **Tracked row:** the first-workflow row now counts toward completion. It reads "Create your first workflow" and links to the workspace home. Once a dev run succeeds, it reads "A test run succeeded" and links to that run. It is done once the workspace has a definition.
  - **Input:** `deriveSetupChecklist` takes a required `firstWorkflow` progress (`open`, `test_run_succeeded` with its `testRunId`, or `done`). `FirstWorkflowProgress` and `FirstWorkflowState` are exported. The quickstart action on this row is removed.
  - **Refresh:** the hosts read each project's definitions and succeeded dev runs, stopping at the first definition. They reload when the window regains focus and poll every 15 seconds while the tab is visible, until the row is done. A dismissed checklist makes no request.
  - **Celebration:** when the home panel sees the row turn done, it plays a burst and captures `first_workflow_activated`. If the same change completes the checklist, only the checklist completion plays. A workspace that already had a definition when the page loaded shows no burst.
  - **Analytics:** `first_workflow_test_run_shown` is captured, with the host, the first time the row shows "A test run succeeded".
  - **`@shipfox/client-workflows`:** exports `listWorkflowRuns`.

- 70eb330: Exports `WorkspaceSetupChecklistProps`.
- cc70c3b: Shippy, the Shipfox mascot, appears on first-use, invitation, and dead-end screens.

  - **`@shipfox/react-ui`:** `EmptyState` gains an optional `illustration` prop that replaces the icon. The `compact` variant keeps its icon.
  - **`@shipfox/client-shell`:** `/runtime` exports `Shippy`, which renders one of nine poses shipped in `assets/shippy`. `AuthShell` gains an optional `illustration` prop that replaces the logo tile. The page-not-found page and the workspace load error page show a pose.
  - **`@shipfox/client-auth`:** the workspace creation page shows a pose.
  - **`@shipfox/client-invitations`:** the invitation page for a signed-out visitor shows a pose.
  - **`@shipfox/client-projects`:** the empty projects list shows a pose.
  - **`@shipfox/client-workflows`:** the empty run list shows a pose.
  - **`@shipfox/client-integrations`:** the empty installed integrations list shows a pose.
  - **`@shipfox/client-agent`:** the empty configured providers list shows a pose.
  - **`@shipfox/client-onboarding`:** the completed setup checklist shows a pose in place of the check icon.

### Patch Changes

- 7d1ae3e: Removes loading phases from client startup. The shell enters the cookie session a declining boot restorer already read instead of refreshing a second time, and `WorkspaceSetupRouteOptions` gains an optional `revalidate` callback that re-runs the workspace setup gate. The onboarding gate lets a workspace that had a project on this device through at once and checks project existence in the background. The lazy onboarding chrome slots load behind their own hidden Suspense boundary, and the setup checklist panel renders nothing until it has loaded and has a step to show.
- f5bdc5b: Exports `FIRST_WORKFLOW_PROMPT` from the browser-safe `@shipfox/workflow-templates/prompt` subpath for consumers that need the first-workflow onboarding prompt.
- e17aa3b: The Get started panel no longer flashes on workspaces that have already completed setup.
- Updated dependencies [16d18f4]
- Updated dependencies [c3b44a2]
- Updated dependencies [8b8b37b]
- Updated dependencies [b97171d]
- Updated dependencies [5f88947]
- Updated dependencies [5a14986]
- Updated dependencies [9806da2]
- Updated dependencies [5588247]
- Updated dependencies [c64d42f]
- Updated dependencies [ba0d750]
- Updated dependencies [807ae57]
- Updated dependencies [c4f486b]
- Updated dependencies [c25c566]
- Updated dependencies [e1cfc2a]
- Updated dependencies [e64c10d]
- Updated dependencies [851908c]
- Updated dependencies [7d1ae3e]
- Updated dependencies [175482e]
- Updated dependencies [3b3e25c]
- Updated dependencies [2e5a311]
- Updated dependencies [a02f5cf]
- Updated dependencies [2c9838a]
- Updated dependencies [f57e1d1]
- Updated dependencies [cc644b8]
- Updated dependencies [b9a53b2]
- Updated dependencies [dc8065c]
- Updated dependencies [eab1dd7]
- Updated dependencies [2021ae8]
- Updated dependencies [c481dab]
- Updated dependencies [8b16e92]
- Updated dependencies [184305a]
- Updated dependencies [48b8237]
- Updated dependencies [5e12647]
- Updated dependencies [2c89020]
- Updated dependencies [fdca5b6]
- Updated dependencies [593142d]
- Updated dependencies [ef7cf4a]
- Updated dependencies [f7e0fb7]
- Updated dependencies [a99c11b]
- Updated dependencies [93b8cac]
- Updated dependencies [fc455ac]
- Updated dependencies [1320dac]
- Updated dependencies [853a185]
- Updated dependencies [ecc70c2]
- Updated dependencies [658d71f]
- Updated dependencies [f5bdc5b]
- Updated dependencies [e3b9558]
- Updated dependencies [8136245]
- Updated dependencies [9674325]
- Updated dependencies [a26baf5]
- Updated dependencies [bea7e50]
- Updated dependencies [5ce9d5b]
- Updated dependencies [3869c1d]
- Updated dependencies [55152c5]
- Updated dependencies [560cee4]
- Updated dependencies [a15e118]
- Updated dependencies [96a66ed]
- Updated dependencies [4aad893]
- Updated dependencies [76d054a]
- Updated dependencies [5fb1fbd]
- Updated dependencies [b1cc902]
- Updated dependencies [a328042]
- Updated dependencies [bea7e50]
- Updated dependencies [42829e8]
- Updated dependencies [cc70c3b]
- Updated dependencies [8317a3c]
- Updated dependencies [d273097]
- Updated dependencies [9674325]
- Updated dependencies [15282f5]
- Updated dependencies [71c11b1]
- Updated dependencies [3c92a34]
- Updated dependencies [257e53e]
- Updated dependencies [e701cfc]
- Updated dependencies [d0c49b5]
- Updated dependencies [00dd046]
- Updated dependencies [da36a04]
- Updated dependencies [fe15ea2]
- Updated dependencies [f9c2dec]
- Updated dependencies [4a664ca]
- Updated dependencies [e663112]
- Updated dependencies [3e8ff99]
- Updated dependencies [70e6983]
- Updated dependencies [15e9d33]
- Updated dependencies [f187551]
- Updated dependencies [d0fcdae]
- Updated dependencies [8786552]
- Updated dependencies [c29a8bb]
- Updated dependencies [8f54fc9]
- Updated dependencies [a4c05ba]
- Updated dependencies [c14f398]
- Updated dependencies [b0b0a82]
- Updated dependencies [2ab4025]
- Updated dependencies [405e69e]
- Updated dependencies [b121f14]
- Updated dependencies [9549da3]
  - @shipfox/api-agent-access-dto@34.0.0
  - @shipfox/client-shell@53.0.0
  - @shipfox/workflow-templates@2.0.0
  - @shipfox/client-integrations@53.0.0
  - @shipfox/client-workflows@53.0.0
  - @shipfox/react-ui@3.4.0
  - @shipfox/client-agent@53.0.0
  - @shipfox/client-projects@53.0.0
  - @shipfox/client-runners@53.0.0
  - @shipfox/client-workspace-settings@53.0.0

## 52.0.3

### Patch Changes

- fe68025: Serve embedded workflow skills as MCP resources with an index, manifest, and audited reads.

  Remove `get_workflow_setup_guide` from the public MCP contract. The entry point is inactive, and no consumer outside this repository uses the tool.

  Point the first workflow prompt at the template skill.

- Updated dependencies [0a8dc4f]
  - @shipfox/react-ui@3.3.0
  - @shipfox/client-agent@52.0.3
  - @shipfox/client-integrations@52.0.3
  - @shipfox/client-projects@52.0.3
  - @shipfox/client-runners@52.0.3
  - @shipfox/client-shell@52.0.3
  - @shipfox/client-workspace-settings@52.0.3

## 52.0.1

### Patch Changes

- Updated dependencies [c021e83]
  - @shipfox/client-integrations@52.0.1
  - @shipfox/client-agent@52.0.1
  - @shipfox/client-projects@52.0.1

## 52.0.0

### Patch Changes

- @shipfox/client-agent@52.0.0
- @shipfox/client-projects@52.0.0

## 51.0.0

### Patch Changes

- Updated dependencies [212c6b6]
  - @shipfox/react-ui@3.2.0
  - @shipfox/client-agent@51.0.0
  - @shipfox/client-integrations@51.0.0
  - @shipfox/client-projects@51.0.0
  - @shipfox/client-runners@51.0.0
  - @shipfox/client-shell@51.0.0
  - @shipfox/client-workspace-settings@51.0.0

## 50.0.0

### Minor Changes

- 1997f6a: Adds the exported first-workflow onboarding panel with MCP setup guidance that reflects the workspace's agent grants, prompt copying, and client analytics.

### Patch Changes

- Updated dependencies [22ef7e3]
- Updated dependencies [6ac3480]
  - @shipfox/client-shell@50.0.0
  - @shipfox/client-integrations@50.0.0
  - @shipfox/client-agent@50.0.0
  - @shipfox/client-projects@50.0.0
  - @shipfox/client-runners@50.0.0
  - @shipfox/client-workspace-settings@50.0.0

## 49.0.0

### Patch Changes

- Updated dependencies [d511ab2]
- Updated dependencies [c44739e]
- Updated dependencies [c45dd5f]
  - @shipfox/react-ui@3.1.0
  - @shipfox/client-integrations@49.0.0
  - @shipfox/client-agent@49.0.0
  - @shipfox/client-projects@49.0.0
  - @shipfox/client-runners@49.0.0
  - @shipfox/client-shell@49.0.0
  - @shipfox/client-workspace-settings@49.0.0

## 48.0.2

### Patch Changes

- 6d4769b: Stops completed onboarding checklists from reporting false shown analytics.
- Updated dependencies [b7469ab]
- Updated dependencies [32f6eac]
  - @shipfox/react-ui@3.0.0
  - @shipfox/client-shell@48.0.2
  - @shipfox/client-workspace-settings@48.0.2
  - @shipfox/client-agent@48.0.2
  - @shipfox/client-integrations@48.0.2
  - @shipfox/client-projects@48.0.2
  - @shipfox/client-runners@48.0.2

## 48.0.1

### Patch Changes

- 6c8f228: Reuses fresh workspace membership data during navigation to avoid blocking each route on the workspace request.
- 61f3cfb: Adds `ps-row` and density-aware spacing for slug warnings, annotation cards, and setup checklists.
- Updated dependencies [61f3cfb]
  - @shipfox/react-ui@2.6.1
  - @shipfox/client-agent@48.0.1
  - @shipfox/client-integrations@48.0.1
  - @shipfox/client-projects@48.0.1
  - @shipfox/client-runners@48.0.1
  - @shipfox/client-shell@48.0.1
  - @shipfox/client-workspace-settings@48.0.1

## 48.0.0

### Patch Changes

- @shipfox/client-runners@48.0.0

## 47.0.0

### Patch Changes

- Updated dependencies [33d9ee2]
- Updated dependencies [29247a2]
  - @shipfox/react-ui@2.6.0
  - @shipfox/client-integrations@47.0.0
  - @shipfox/client-projects@47.0.0
  - @shipfox/client-agent@47.0.0
  - @shipfox/client-runners@47.0.0
  - @shipfox/client-shell@47.0.0
  - @shipfox/client-workspace-settings@47.0.0

## 46.0.1

### Patch Changes

- Updated dependencies [15f7b58]
- Updated dependencies [aa6726e]
- Updated dependencies [3d1afa1]
  - @shipfox/react-ui@2.5.0
  - @shipfox/client-integrations@46.0.1
  - @shipfox/client-agent@46.0.1
  - @shipfox/client-projects@46.0.1
  - @shipfox/client-runners@46.0.1
  - @shipfox/client-shell@46.0.1
  - @shipfox/client-workspace-settings@46.0.1

## 46.0.0

### Patch Changes

- f2c3e90: Allows members to open invitation settings before project setup and adds an invitation link to source-control setup.
- Updated dependencies [717736a]
- Updated dependencies [f2c3e90]
- Updated dependencies [34037aa]
- Updated dependencies [0ddc7ef]
  - @shipfox/client-agent@46.0.0
  - @shipfox/client-integrations@46.0.0
  - @shipfox/client-shell@46.0.0
  - @shipfox/client-projects@46.0.0
  - @shipfox/client-runners@46.0.0
  - @shipfox/client-workspace-settings@46.0.0

## 45.0.0

### Patch Changes

- @shipfox/client-agent@45.0.0
- @shipfox/client-integrations@45.0.0
- @shipfox/client-projects@45.0.0
- @shipfox/client-runners@45.0.0
- @shipfox/client-shell@45.0.0
- @shipfox/client-workspace-settings@45.0.0

## 44.0.0

### Patch Changes

- Updated dependencies [4d3b34b]
- Updated dependencies [fb73bca]
- Updated dependencies [b9d7c01]
  - @shipfox/client-integrations@44.0.0
  - @shipfox/react-ui@2.4.0
  - @shipfox/client-agent@44.0.0
  - @shipfox/client-shell@44.0.0
  - @shipfox/client-projects@44.0.0
  - @shipfox/client-runners@44.0.0
  - @shipfox/client-workspace-settings@44.0.0

## 43.0.0

### Patch Changes

- Updated dependencies [14bc3d6]
  - @shipfox/client-shell@43.0.0
  - @shipfox/client-runners@43.0.0
  - @shipfox/client-agent@43.0.0
  - @shipfox/client-integrations@43.0.0
  - @shipfox/client-projects@43.0.0
  - @shipfox/client-workspace-settings@43.0.0

## 42.0.0

### Patch Changes

- @shipfox/client-runners@42.0.0
- @shipfox/client-projects@42.0.0

## 41.0.1

### Patch Changes

- @shipfox/client-projects@41.0.1

## 41.0.0

### Patch Changes

- Updated dependencies [f22cfe7]
- Updated dependencies [89ad9f0]
  - @shipfox/client-shell@41.0.0
  - @shipfox/client-agent@41.0.0
  - @shipfox/client-integrations@41.0.0
  - @shipfox/client-projects@41.0.0
  - @shipfox/client-runners@41.0.0
  - @shipfox/client-workspace-settings@41.0.0

## 40.0.0

### Patch Changes

- Updated dependencies [08a551b]
- Updated dependencies [543f5b2]
- Updated dependencies [72d8146]
- Updated dependencies [543f5b2]
  - @shipfox/client-shell@40.0.0
  - @shipfox/react-ui@2.3.5
  - @shipfox/client-agent@40.0.0
  - @shipfox/client-integrations@40.0.0
  - @shipfox/client-projects@40.0.0
  - @shipfox/client-runners@40.0.0
  - @shipfox/client-workspace-settings@40.0.0

## 39.0.0

### Patch Changes

- Updated dependencies [b4a5de1]
  - @shipfox/client-shell@39.0.0
  - @shipfox/client-agent@39.0.0
  - @shipfox/client-integrations@39.0.0
  - @shipfox/client-projects@39.0.0
  - @shipfox/client-runners@39.0.0
  - @shipfox/client-workspace-settings@39.0.0

## 38.0.0

### Patch Changes

- Updated dependencies [0dbc3f6]
  - @shipfox/client-shell@38.0.0
  - @shipfox/client-agent@38.0.0
  - @shipfox/client-integrations@38.0.0
  - @shipfox/client-projects@38.0.0
  - @shipfox/client-runners@38.0.0
  - @shipfox/client-workspace-settings@38.0.0

## 37.0.0

### Patch Changes

- Updated dependencies [7fed218]
- Updated dependencies [7ed04a3]
  - @shipfox/client-agent@37.0.0
  - @shipfox/client-shell@37.0.0
  - @shipfox/client-projects@37.0.0
  - @shipfox/client-integrations@37.0.0
  - @shipfox/client-runners@37.0.0
  - @shipfox/client-workspace-settings@37.0.0
  - @shipfox/react-ui@2.3.4

## 36.0.0

### Patch Changes

- @shipfox/client-integrations@36.0.0
- @shipfox/client-projects@36.0.0

## 35.0.0

### Patch Changes

- @shipfox/client-projects@35.0.0

## 34.0.0

### Patch Changes

- @shipfox/client-runners@34.0.0
- @shipfox/client-shell@32.0.0
- @shipfox/client-agent@34.0.0
- @shipfox/client-projects@34.0.0

## 33.0.0

### Patch Changes

- Updated dependencies [5886bf2]
  - @shipfox/client-integrations@33.0.0
  - @shipfox/client-agent@33.0.0
  - @shipfox/client-projects@33.0.0
  - @shipfox/client-runners@33.0.0

## 32.0.0

### Patch Changes

- Updated dependencies [0b32d1a]
  - @shipfox/client-agent@32.0.0
  - @shipfox/client-projects@32.0.0
  - @shipfox/client-shell@32.0.0
  - @shipfox/client-integrations@32.0.0
  - @shipfox/client-workspace-settings@32.0.0
  - @shipfox/client-runners@32.0.0

## 31.0.1

### Patch Changes

- @shipfox/client-projects@31.0.1
- @shipfox/client-agent@31.0.1
- @shipfox/client-integrations@31.0.1
- @shipfox/client-runners@31.0.1
- @shipfox/client-shell@31.0.1
- @shipfox/client-workspace-settings@31.0.1

## 31.0.0

### Patch Changes

- Updated dependencies [03df2b7]
- Updated dependencies [f4dbc1a]
  - @shipfox/client-integrations@31.0.0
  - @shipfox/client-shell@31.0.0
  - @shipfox/client-projects@31.0.0
  - @shipfox/client-agent@31.0.0
  - @shipfox/client-runners@31.0.0
  - @shipfox/client-workspace-settings@31.0.0

## 30.0.1

### Patch Changes

- @shipfox/client-shell@30.0.1
- @shipfox/client-projects@30.0.1
- @shipfox/client-agent@30.0.1
- @shipfox/client-integrations@30.0.1
- @shipfox/client-workspace-settings@30.0.1
- @shipfox/client-runners@30.0.1

## 30.0.0

### Minor Changes

- ac8066f: Collapses the Get-started panel to the next step. A header toggle opens the
  full list and remembers the choice per device, and the nav-bar indicator still
  carries the whole checklist on every route.

### Patch Changes

- bfc544f: Improves workspace setup checklist announcements for assistive technology.
- Updated dependencies [a7ad0a9]
- Updated dependencies [2881385]
  - @shipfox/react-ui@2.3.4
  - @shipfox/client-integrations@30.0.0
  - @shipfox/client-shell@30.0.0
  - @shipfox/client-runners@30.0.0
  - @shipfox/client-agent@30.0.0
  - @shipfox/client-projects@30.0.0
  - @shipfox/client-workspace-settings@30.0.0

## 29.0.0

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
- Updated dependencies [b416c4c]
- Updated dependencies [2f35a8b]
  - @shipfox/client-agent@29.0.0
  - @shipfox/client-integrations@29.0.0
  - @shipfox/client-projects@29.0.0
  - @shipfox/client-runners@29.0.0
  - @shipfox/client-shell@29.0.0
  - @shipfox/react-ui@2.3.3
  - @shipfox/client-workspace-settings@29.0.0

## 28.0.0

### Patch Changes

- @shipfox/client-agent@28.0.0
- @shipfox/client-shell@28.0.0
- @shipfox/client-runners@28.0.0
- @shipfox/client-integrations@28.0.0
- @shipfox/client-projects@28.0.0
- @shipfox/client-workspace-settings@28.0.0

## 27.0.1

### Patch Changes

- Updated dependencies [87b71ed]
  - @shipfox/react-ui@2.3.2
  - @shipfox/client-agent@27.0.1
  - @shipfox/client-integrations@27.0.1
  - @shipfox/client-projects@27.0.1
  - @shipfox/client-runners@27.0.1
  - @shipfox/client-shell@27.0.1
  - @shipfox/client-workspace-settings@27.0.1

## 27.0.0

### Patch Changes

- Updated dependencies [5ae8b3d]
- Updated dependencies [515b14c]
- Updated dependencies [be5fb95]
  - @shipfox/client-shell@27.0.0
  - @shipfox/react-ui@2.3.1
  - @shipfox/client-agent@27.0.0
  - @shipfox/client-integrations@27.0.0
  - @shipfox/client-projects@27.0.0
  - @shipfox/client-runners@27.0.0
  - @shipfox/client-workspace-settings@27.0.0

## 26.0.0

### Patch Changes

- Updated dependencies [79e1ed7]
- Updated dependencies [48e8c4a]
  - @shipfox/react-ui@2.3.0
  - @shipfox/client-projects@26.0.0
  - @shipfox/client-agent@26.0.0
  - @shipfox/client-integrations@26.0.0
  - @shipfox/client-runners@26.0.0
  - @shipfox/client-shell@26.0.0
  - @shipfox/client-workspace-settings@26.0.0

## 25.0.0

### Minor Changes

- f57bcc3: Adds the workspace setup checklist panel and top-bar indicator.

### Patch Changes

- de25460: Makes the onboarding completion burst deterministic in reduced-motion environments.
- Updated dependencies [af27652]
- Updated dependencies [f57bcc3]
  - @shipfox/client-shell@25.0.0
  - @shipfox/client-integrations@25.0.0
  - @shipfox/client-projects@25.0.0
  - @shipfox/client-agent@25.0.0
  - @shipfox/client-runners@25.0.0
  - @shipfox/client-workspace-settings@25.0.0

## 24.0.0

### Patch Changes

- Updated dependencies [989eb11]
  - @shipfox/client-agent@24.0.0
  - @shipfox/client-projects@24.0.0
  - @shipfox/client-integrations@24.0.0
  - @shipfox/client-shell@24.0.0

## 23.0.0

### Minor Changes

- f64c66f: Adds `deriveIntegrationReadiness` and `deriveSetupChecklist`, which derive
  per-provider integration-connected and attention state and the workspace
  Get-started setup checklist.

### Patch Changes

- Updated dependencies [693e656]
- Updated dependencies [f7b3db8]
  - @shipfox/client-shell@23.0.0
  - @shipfox/client-projects@23.0.0
  - @shipfox/client-agent@23.0.0
  - @shipfox/client-integrations@23.0.0

## 22.0.3

### Patch Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.
- Updated dependencies [0d3c2e3]
- Updated dependencies [b734450]
- Updated dependencies [ddcc546]
  - @shipfox/client-agent@22.0.3
  - @shipfox/client-integrations@22.0.3
  - @shipfox/client-projects@22.0.3
  - @shipfox/client-shell@22.0.3

## 22.0.2

### Patch Changes

- @shipfox/client-agent@22.0.2
- @shipfox/client-integrations@22.0.2
- @shipfox/client-projects@22.0.2
- @shipfox/client-shell@22.0.2

## 22.0.1

### Patch Changes

- Updated dependencies [e92517f]
  - @shipfox/client-agent@22.0.1
  - @shipfox/client-integrations@22.0.1
  - @shipfox/client-shell@22.0.1
  - @shipfox/client-projects@22.0.1

## 22.0.0

### Patch Changes

- Updated dependencies [50b3867]
- Updated dependencies [7693eb3]
- Updated dependencies [00c1cb8]
- Updated dependencies [00c1cb8]
- Updated dependencies [56f4526]
  - @shipfox/client-agent@22.0.0
  - @shipfox/client-integrations@22.0.0
  - @shipfox/client-shell@22.0.0
  - @shipfox/client-projects@22.0.0

## 21.0.0

### Patch Changes

- Updated dependencies [9c21429]
- Updated dependencies [c4376a1]
- Updated dependencies [0e860d7]
  - @shipfox/client-shell@21.0.0
  - @shipfox/client-agent@21.0.0
  - @shipfox/client-integrations@21.0.0
  - @shipfox/client-projects@21.0.0

## 17.0.0

### Patch Changes

- @shipfox/client-agent@17.0.0
- @shipfox/client-integrations@17.0.0
- @shipfox/client-projects@17.0.0
- @shipfox/client-shell@17.0.0

## 16.0.0

### Patch Changes

- Updated dependencies [654da7f]
  - @shipfox/client-integrations@16.0.0
  - @shipfox/client-projects@16.0.0
  - @shipfox/client-agent@16.0.0
  - @shipfox/client-shell@16.0.0

## 15.0.0

### Patch Changes

- Updated dependencies [bca115c]
  - @shipfox/client-agent@15.0.0
  - @shipfox/client-projects@15.0.0
  - @shipfox/client-integrations@14.0.1
  - @shipfox/client-shell@14.0.1

## 14.0.1

### Patch Changes

- Updated dependencies [88bf8e8]
- Updated dependencies [6aa6c7a]
  - @shipfox/client-shell@14.0.1
  - @shipfox/client-integrations@14.0.1
  - @shipfox/client-projects@14.0.1
  - @shipfox/client-agent@14.0.1

## 14.0.0

### Patch Changes

- Updated dependencies [1267eb3]
  - @shipfox/client-integrations@14.0.0
  - @shipfox/client-agent@14.0.0
  - @shipfox/client-projects@14.0.0
  - @shipfox/client-shell@14.0.0

## 13.0.0

### Major Changes

- e405e92: Move client routes to slug-based `/w/$workspaceSlug` and `/p/$projectSlug` URLs, enforce the new composition contract, and support bounded project-slug resolution.

### Patch Changes

- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- Updated dependencies [e405e92]
- Updated dependencies [f78740d]
- Updated dependencies [9fdd5e4]
- Updated dependencies [3c73365]
- Updated dependencies [4eb18b8]
- Updated dependencies [54c820e]
- Updated dependencies [e1efaee]
  - @shipfox/client-agent@13.0.0
  - @shipfox/client-integrations@13.0.0
  - @shipfox/client-projects@13.0.0
  - @shipfox/client-shell@13.0.0

## 12.0.2

### Patch Changes

- @shipfox/client-shell@12.0.2
- @shipfox/client-projects@12.0.2
- @shipfox/client-integrations@12.0.2
- @shipfox/client-agent@12.0.2

## 12.0.1

### Patch Changes

- @shipfox/client-integrations@12.0.1
- @shipfox/client-projects@12.0.1
- @shipfox/client-shell@12.0.1
- @shipfox/client-agent@12.0.1

## 12.0.0

### Patch Changes

- Updated dependencies [96ae951]
  - @shipfox/client-shell@12.0.0
  - @shipfox/client-projects@12.0.0
  - @shipfox/client-agent@12.0.0
  - @shipfox/client-integrations@12.0.0

## 11.0.0

### Minor Changes

- e9280fc: Add an observer-authorized administrator workspace lookup with bounded safe summaries,
  best-effort job counts, and a neutral unavailable-workspace member experience for
  suspended or deleted workspaces.

### Patch Changes

- Updated dependencies [662516d]
- Updated dependencies [43ce975]
- Updated dependencies [e9280fc]
  - @shipfox/client-shell@11.0.0
  - @shipfox/client-agent@11.0.0
  - @shipfox/client-integrations@11.0.0
  - @shipfox/client-projects@11.0.0

## 10.0.1

### Patch Changes

- @shipfox/client-shell@10.0.1
- @shipfox/client-integrations@10.0.1
- @shipfox/client-projects@10.0.1
- @shipfox/client-agent@10.0.1

## 10.0.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/client-shell@10.0.0
  - @shipfox/client-agent@10.0.0
  - @shipfox/client-integrations@10.0.0
  - @shipfox/client-projects@10.0.0

## 9.0.0

### Patch Changes

- Updated dependencies [56e2c58]
- Updated dependencies [87170f8]
- Updated dependencies [8e1820a]
  - @shipfox/client-shell@9.0.0
  - @shipfox/client-integrations@9.0.0
  - @shipfox/client-agent@9.0.0
  - @shipfox/client-projects@9.0.0

## 8.0.0

### Patch Changes

- Updated dependencies [289d686]
- Updated dependencies [ac2ac4a]
  - @shipfox/client-shell@8.0.0
  - @shipfox/client-integrations@8.0.0
  - @shipfox/client-projects@8.0.0
  - @shipfox/client-agent@8.0.0

## 7.0.0

### Patch Changes

- @shipfox/client-integrations@7.0.0
- @shipfox/client-projects@7.0.0

## 6.0.3

### Patch Changes

- @shipfox/client-integrations@6.0.3
- @shipfox/client-projects@6.0.3

## 6.0.2

### Patch Changes

- Updated dependencies [102c5f4]
  - @shipfox/client-shell@6.0.2
  - @shipfox/client-agent@6.0.2
  - @shipfox/client-projects@6.0.2
  - @shipfox/client-integrations@6.0.2

## 6.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
- Updated dependencies [3f8f1cb]
  - @shipfox/client-agent@6.0.1
  - @shipfox/client-integrations@6.0.1
  - @shipfox/client-projects@6.0.1
  - @shipfox/client-shell@6.0.1

## 6.0.0

### Patch Changes

- Updated dependencies [401b583]
- Updated dependencies [e009149]
- Updated dependencies [d784a07]
- Updated dependencies [82eda45]
- Updated dependencies [125c90f]
- Updated dependencies [f2d50a8]
- Updated dependencies [cd90c19]
- Updated dependencies [24be269]
- Updated dependencies [c56c124]
- Updated dependencies [fa07be9]
- Updated dependencies [46aa52f]
- Updated dependencies [9d8f510]
- Updated dependencies [4a6d124]
- Updated dependencies [c02ac42]
- Updated dependencies [c097dff]
  - @shipfox/client-agent@6.0.0
  - @shipfox/client-integrations@6.0.0
  - @shipfox/client-projects@6.0.0
  - @shipfox/client-shell@6.0.0

## 5.0.0

### Minor Changes

- 8d8cdef: Extracts workspace onboarding into a dedicated coordinator and shares its feature query policies.

### Patch Changes

- Updated dependencies [8d8cdef]
- Updated dependencies [ffd727b]
- Updated dependencies [f1d6465]
  - @shipfox/client-agent@5.0.0
  - @shipfox/client-integrations@5.0.0
  - @shipfox/client-projects@5.0.0
  - @shipfox/client-shell@5.0.0
