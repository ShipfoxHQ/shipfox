# @shipfox/workflow-templates

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
