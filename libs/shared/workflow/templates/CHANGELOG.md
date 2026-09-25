# @shipfox/workflow-templates

## 1.2.0

### Minor Changes

- 94a6e9d: The create-workflow-from-template and write-a-workflow skills now ask one question per message and restate what each choice decides and entails. Every template option choice now describes its tradeoff, and the ticket-to-pr guide no longer lists Linear agent-session setup that cloud-hosted Shipfox handles.
- e4f160d: The ticket to pull request template's `label` trigger also starts a run when a Linear issue is created with the chosen label. The template revision is now 2.

### Patch Changes

- 310bf1d: Direct workflow creation skills to find the current schema reference and relevant design guidance through Shipfox documentation search.
- 7062352: Waits for a matching event before a workflow dev run unless the user cannot trigger one or asks to skip.
- 6759ba2: Updates the shipped workflow templates' model and thinking selections.

## 1.1.0

### Minor Changes

- 238df72: Adds separate skills for validating and testing local workflow changes, and shortens the development run tool description.
- 81c982a: Add a workflow run debugging skill that traces job and step failures, checks events when no run starts, and reports when user action is needed.
- 1092419: Revise the create-workflow-from-template skill: users confirm the full model and thinking setting, replay events are limited to the selected project, failed real runs need an explicit decision before any writes repeat, and a successful run is confirmed with the user before the pull request. The skill no longer offers template upgrades.
- 3bc43e5: Serves the complete create-workflow-from-template procedure as one MCP skill and links its validation, testing, and template references.
- 0bd5f3d: Add a Shipfox skill for writing a workflow from a repository and connected workspace facts.

## 1.0.0

### Major Changes

- f03324a: Replaces model profiles and `resolved_models` with `suggested_models` in template results. It lists available model and thinking choices and ranks qualified measured combinations by cost.

### Minor Changes

- fe68025: Serve embedded workflow skills as MCP resources with an index, manifest, and audited reads.

  Remove `get_workflow_setup_guide` from the public MCP contract. The entry point is inactive, and no consumer outside this repository uses the tool.

  Point the first workflow prompt at the template skill.

## 0.5.0

### Minor Changes

- d593e1b: Adds a Linear ticket to pull request template with GitHub feedback handling.
- 3494bf1: Adds a `default` thinking option that requests the provider default without applying workspace or deployment overrides.

### Patch Changes

- Updated dependencies [3494bf1]
  - @shipfox/workflow-document@3.10.0

## 0.4.0

### Minor Changes

- e13617c: Adds the dependency-bot CI template and corrects provider part types for embedded templates.
- 751ae3a: Adds model placeholders and optional tested references to workflow template manifests.

## 0.3.0

### Minor Changes

- 68f10d5: Adds a versioned first-party workflow setup guide and its read-only MCP tool.

## 0.2.0

### Minor Changes

- 0f2bf90: Adds model profiles and workspace-resolved model selections to workflow template results.
- d3eb572: Adds the workflow template manifest, part composer, and template loader for composing first-party workflow templates from embedded assets.

### Patch Changes

- Updated dependencies [17d86bf]
- Updated dependencies [bcd9232]
- Updated dependencies [bd03ee1]
  - @shipfox/workflow-document@3.9.0
