# Workflow templates
A library for composing first-party workflow templates from embedded YAML and Markdown assets.

## What it does

- **`workflowTemplateManifestSchema`** checks template presentation fields, keywords, starts, flow, writes, prerequisites, related templates, roles, options, model placeholders, and described slots, secrets, and variables.
- **`composeWorkflow`** replaces `# part:<role>.<name>` markers with text blocks at the marker indentation.
- **`composeTemplate`** selects one provider part for every bound role, composes the workflow, and writes its `# shipfox-template:` header. An optional third argument takes the chosen `options` and a `header` choice.
- **`applyTemplateOptions`** keeps the `# option:X=Y` blocks whose choice is chosen, deletes the other blocks of that option, and removes the marker lines.
- **`SUPPORTED_COMPOSITIONS`** lists the composition formats `composeTemplate` and `applyTemplateOptions` accept through their `composition` input. See [Composition formats](#composition-formats).
- **`parseTemplateHeader`** reads a `# shipfox-template:` header, in its registry or legacy form, without the manifest. It is also exported from the browser-safe `@shipfox/workflow-templates/header` subpath, with `formatTemplateHeader`.
- **`templateRoleBindings`** lists every role binding a template supports, with each optional role both bound and unbound.
- **`templateVariants`** lists the bindings and option selections needed to statically compose every template variant.
- **`computeTemplateBump`** returns the minimum semantic-version bump between two parsed manifests. The registry and the release tool use it. See [Version bumps](#version-bumps).
- **`deriveTemplateMetadata`** returns the `derived` field of a template version document from the manifest and the content bundle size: the integrations, the slots, secrets, and variables, the role and option choices, and the size. `workflowTemplateMetadataSchema` validates it.
- **`extractModelAnchors`** reads each placeholder's tested model and thinking setting from composed YAML.
- **`recommendModels`** selects up to four scored alternatives to a tested model and labels their intelligence and cost tradeoffs.
- **`buildTemplatePrompt`** builds the prompt a user pastes into a coding agent to set up a template. It is also exported from the browser-safe `@shipfox/workflow-templates/prompt` subpath.
- **`buildUpgradePrompt`** builds the prompt a user pastes into a coding agent to upgrade an adopted template to a version. See [Upgrade prompts](#upgrade-prompts). It is exported from the same `/prompt` subpath.
- **`TemplateLoader`** is the asynchronous, version-aware loader interface. See [Template loader](#template-loader).
- **`createTemplateLoader`** creates an injectable loader for tests or other asset sources. Each loaded template reports its package name, version, identity, and embedded compatibility values beside the manifest, plus `startsManually`.
- **`shippedTemplateLoader`** serves only assets embedded during the package build.
- **`resolveTemplatePackage`** turns a bare template id, such as `ticket-to-pr`, into its first-party package name, `shipfox/ticket-to-pr`.
- **`createDirectoryTemplateLoader`** serves a catalog directory. It is exported from the node-only `@shipfox/workflow-templates/testing` subpath.
- **`listShippedSkillResources`** lists the embedded skill index, manifest, procedures, and references.
- **`getShippedSkillResource`** reads one embedded resource by its exact `skill://shipfox/` URI.

The package does not evaluate expressions or implement conditionals and loops. It keeps template comments in the composed YAML so the coding agent can use binding, slot, and option instructions.

## Installation and setup

```sh
pnpm add @shipfox/workflow-templates
```

The package build reads `assets/skills/` and the first-party template packages in `libs/shared/workflow/catalog/templates/`. It embeds the skill files, manifests, workflows, guides, and provider parts into a generated TypeScript module. The API image therefore does not copy these files at runtime.

## Usage

```ts
import {composeWorkflow} from '@shipfox/workflow-templates';

const workflowYaml = composeWorkflow(
  ['jobs:', '  build:', '    # part:source.checkout'].join('\n'),
  {checkout: '- key: checkout\n  prompt: Check out the repository.'},
);
```

Tests can inject a fixture with `createTemplateLoader`, or serve the catalog directory with `createDirectoryTemplateLoader`. Fixture files live under the package `test/` directory, including the [fixture guide](test/fixtures/GUIDE.md). The shipped loader never reads or returns those files.

## Behavior notes

### Template loader

Every method of `TemplateLoader` returns a promise, so a loader can read from the registry:

```ts
const loader: TemplateLoader = shippedTemplateLoader;

await loader.list(); // the latest servable version of each template
await loader.get({package: 'shipfox/ticket-to-pr', version: '1.0.0'}); // `version` is optional
await loader.versions({package: 'shipfox/ticket-to-pr'}); // newest first
await loader.compose({package: 'ticket-to-pr', bindings, options});
```

`package` is the registry package name. A bare id is the first-party package of that name. Without `version`, `get` and `compose` use the latest servable version, and `compose` returns `undefined` for an unknown package or version. `compose` applies `options` to the YAML with `applyTemplateOptions`, and the loader chooses the header form: the embedded loader always writes the legacy header, so it never claims a registry base.

Assets passed to `createTemplateLoader` that share an `id` are versions of one template, ordered by semantic version. The embedded loader's `version` is the `version` of the template's catalog package. `createDirectoryTemplateLoader(path)` reads the same directory layout, and has no compatibility file, so its templates report `revision` as the major version, `rank` as the position in id order, and `added_at` as the epoch. Compare its output with the embedded copy only apart from the legacy header.

### Marker conventions

The composer recognizes one part marker per line:

```yaml
jobs:
  # part:tracker.read_ticket
```

It replaces the marker with the matching block and prefixes every non-empty line with the marker indentation. The block keeps its own comments, including `bind:` and `slot:` comments.

The following comments are preserved as authoring instructions:

- `# bind:<role>` identifies a connection binding.
- `# slot:<name>` identifies a value the agent fills from the manifest slot.
- `# model:<key>` identifies a model value on an agent step's `model:` line. Each key needs a `models` entry in the manifest.
- `# option:X=Y begin` and `# option:X=Y end` surround an optional block. `X=Y,Z` keeps the block when any listed choice is chosen.
- `# shipfox-template:` identifies an adopted composed template. `composeTemplate` writes it after leading comments, so base workflows must not declare it. See [Template header](#template-header).

The composer only substitutes `part:` markers. It does not evaluate expressions, conditionals, or loops. A missing part or required provider binding throws an error.

Each `models` entry needs a matching marker in `workflow.yml` or a provider part. The entry can include a `note` for the user. The loader composes every role binding and rejects missing, unknown, incomplete, or conflicting markers. Keep model markers out of optional-role parts, because the composition without that role would lose them.

### Template header

`composeTemplate` writes one of two header forms. The legacy form is the default:

```yaml
# shipfox-template: ticket-to-pr@3 source=github tracker=linear
```

The registry form names the registry package version, then its bound roles and chosen options. Roles come first, then options, each in manifest order, and an empty group is omitted:

```yaml
# shipfox-template: shipfox/ticket-to-pr@1.2.0; roles: source=github tracker=linear; options: feedback_loop=on pr_mode=draft
```

Ask for it with `composeTemplate(template, bindings, {header: {kind: 'registry', reference}, options})`. A template served from the embedded copy keeps the legacy header, so an adoption never claims a registry base that may not exist. The composer checks `options` against the manifest and records them only in the registry form, because the legacy form has no options group. It does not apply them to the YAML.

`parseTemplateHeader(text)` reads either form from workflow YAML or from the header line alone, and returns `{ref, bindings, options}` or `{legacy: {id, revision, bindings}}`. The group names tell roles from options, so a role and an option can share a name and no manifest is needed. It searches only the leading comment lines. It returns `undefined` when there is no header, or when it is malformed: a range or tag instead of an exact version, an unknown, empty, repeated, or misordered group, or a repeated key.

`applyTemplateOptions(yaml, options)` resolves the option blocks. `# option:X=Y,Z begin` keeps its block when either `Y` or `Z` is chosen for `X`. Blocks can nest. An option with no chosen value keeps its blocks and markers, so `{}` changes nothing. An unclosed block, or an end marker that does not match, throws. Lines such as `# option:bot_identity`, `# slot:`, `# bind:`, and `# model:` stay.

### Composition formats

A composition format freezes how the composer handles markers and indentation, writes the header, and applies options. Template upgrades rebuild an adopted base byte for byte, possibly on a newer composer, so the behavior of a supported format never changes. A change to any of those is a new format with its own code path, added to `SUPPORTED_COMPOSITIONS`. A caller that passes an unsupported `composition` gets an `UnsupportedCompositionError`.

`test/golden/composition-<n>/` holds the composer's output for one fixture template in `test/golden/fixture/`. The fixture exists to exercise every composer behavior, not to mirror a shipped template: part markers, dedenting and indentation, a role with several providers, an optional role, multi-choice and nested option blocks, an option block inside a part, and model, slot, and bind comments. It composes every binding with its default choices under both header grammars, and the richest binding with no options and with each option choice alone. A test compares the composer with those files byte for byte and fails when a supported format has no corpus.

Two more tests keep the fixture representative. One fails when the fixture stops using a behavior it is meant to cover. The other fails when a shipped template uses a behavior the fixture does not cover. Extend the fixture in that case. Do not change what an existing format produces, because that requires a new format.

Shipped templates can change freely. The corpus changes only when the composer does. To regenerate the current format's files after a deliberate fixture extension, and review the diff:

```sh
pnpm --filter @shipfox/workflow-templates golden:generate
```

### Optional roles

A role can set `optional: true` with a `question` and a `tradeoff`, so the user opts into part of a template:

```yaml
roles:
  report:
    providers: [slack]
    optional: true
    question: Should the workflow post its outcome to Slack?
    tradeoff: Posts one Slack message per investigated failure.
```

When an optional role is unbound, `composeTemplate` removes its `# part:` markers and leaves it out of the header. Keep everything that depends on the role inside its parts, such as a whole job. A role with `from: project` cannot be optional.

`extractModelAnchors` reads markers after provider parts are composed and before options are applied. It returns the model and sibling `thinking` value for each placeholder. Repeated markers must agree. The marked `model` and `thinking` values are the setting the template author tested, so write only a tested setting there.

### Identity and start phrases

Every manifest requires `starts`, a phrase of at most 120 characters that describes how the workflow begins. The loader derives `startsManually` by composing every role binding and checking each result with `@shipfox/workflow-document`. It is true only when every composition has a `source: manual` trigger, so an optional role cannot make a non-manual template count as manual.

The embedded loader takes each template id from its asset directory. It reads `revision`, `added_at`, and `rank` from [`embedded-templates.yaml`](embedded-templates.yaml) and exposes those values beside the manifest. Catalog packages do not include this compatibility file.

### Catalog metadata

`keywords`, `flow`, `writes`, `prerequisites`, and `related` describe a template for catalogs and coding agents:

- `keywords` holds up to 10 unique slugs for search. Leave out provider names, which the roles already give.
- `flow` lists the steps in order. Each has a `kind` (`trigger`, `agent`, `check`, `tool`, `write`, or `human`), a `title`, a `detail`, and an optional `provider` from the roles or `shipfox`. `loops_to` sends work back to an earlier step by index.
- `writes` lists every write the template can make, as `{provider?, action}`. Put conditions in the sentence, such as "With a tracker, comments on the ticket." Omit `provider` when it depends on the user's choice. Say where the template writes and how often, not every message it can post.
- `prerequisites` lists user actions that the roles do not imply, such as inviting the Shipfox app to a channel. Do not list connections: binding each role already requires one.
- `related` holds registry package names, such as `shipfox/fix-dependency-ci`.

`writes` and `prerequisites` carry no conditions. Consumers show them as authored, and the coding agent applies them to the user's choices. Guides do not repeat either list.

### Version bumps

`computeTemplateBump({previous, next})` compares manifests only, so it never sees the workflow body or the prompts. The version number tells how much work an upgrade is:

| Change | Bump |
| --- | --- |
| Required role added, role removed, provider removed from a role, or an optional role made required | major |
| Option or choice removed | major |
| Slot, secret, or variable added | major |
| Optional role added, provider added to a role | minor |
| Option or choice added, `writes` entry added | minor |
| Anything else, including workflow body, prompts, and removed or reworded slots | patch |

A `writes` entry has no id, so its provider, when it has one, and its text identify it. A reworded entry counts as an added one. When a change fits several rows, the highest bump wins.

`deriveTemplateMetadata` uses only the manifest. Facts that need composition, such as manual trigger inputs, workflow outputs, model anchors, and composed previews, depend on the platform version, so consumers compute them with the composer.

### Setup prompts

`buildTemplatePrompt({templateId, choices})` returns `Use Shipfox to create a workflow from the <id> template.` Each `choices` clause, such as `with Slack as the report` or `without the tracker part`, is appended, so the create-workflow-from-template skill confirms it instead of asking. Browser code imports it from `@shipfox/workflow-templates/prompt`, because the package root embeds every template asset.

### Upgrade prompts

`buildUpgradePrompt({package, configPath, version})` returns ``Use Shipfox to upgrade the <id> workflow in `<path>` to <version>.`` A first-party package is named by its bare id, and the path is left out when the workflow has none. The upgrade-workflow skill takes the prompt from there.

### Model recommendations

`recommendModels({anchor, models})` takes a scored, resolved template anchor and the workspace catalog. It considers only models with a lab on the anchor's scale and within ten intelligence-index points, and excludes every thinking level of the anchor's model. It first selects the cheapest cheaper alternative (within three points below the anchor), then the cheapest model more than three points smarter, and fills up to four alternatives by score proximity while preferring labs not yet represented. A selected model removes all of its thinking levels from later slots. Results are ordered by intelligence index, highest first, and each result includes dimension-specific intelligence and cost tradeoff keys and display copy.

### Asset layout

Skills and the compatibility file live in this package. Each first-party template is a private workspace package (`@shipfox/template-<template-id>`, version `1.0.0`) under the catalog. A shipped asset uses this layout:

```text
assets/skills/<skill-name>/SKILL.md
assets/skills/<skill-name>/references/*.md
embedded-templates.yaml
../catalog/templates/<template-id>/
  package.json
  template.yaml
  workflow.yml
  GUIDE.md
  parts/<role>/<provider>.yml
```

To check a local workflow without starting a run, read `skill://shipfox/validate-workflow-change/SKILL.md` through MCP. It covers trigger inputs, retained events, dry-run refusals, and verification.

To run a validated change against a real trigger, read `skill://shipfox/test-workflow-change/SKILL.md` through MCP. It covers side effects, run inspection, retries, and checkout order.

Each part file is a YAML map from part name to a literal text block. The source role can declare `from: project` so later consumers resolve its provider from the selected project. A template without such a role, such as `report-failed-runs`, still takes a project but binds no project-specific source connection.

Provider tool IDs, event names, and connection bindings belong in parts. The one exception is the built-in `shipfox` connection, which exists in every workspace: `workflow.yml` can bind it directly with `source: shipfox` and `connection: shipfox`.

Shipped templates keep an adaptation guide beside their workflow. For pull request CI repair, read `skill://shipfox/create-workflow-from-template/references/fix-dependency-ci.md` through MCP. It covers PR selection, repair limits, choices, and customization slots.
For Slack or Discord codebase questions, read `skill://shipfox/create-workflow-from-template/references/ask-codebase.md`. It covers channel scope, manual dispatch inputs, outcomes, and failures.
For default-branch CI failures, read `skill://shipfox/create-workflow-from-template/references/fix-default-branch-ci.md`. It covers duplicate limits, outcomes, the optional Slack report, and delivery failures.
For failed run reports, read `skill://shipfox/create-workflow-from-template/references/report-failed-runs.md`. It covers run event filters, options, and failed reports.
For tasks to pull requests, read `skill://shipfox/create-workflow-from-template/references/ticket-to-pr.md`. It covers manual task inputs, workflow outputs, the optional tracker, and how runs link and fail.
For Slack conversations that become tickets, read `skill://shipfox/create-workflow-from-template/references/slack-to-ticket.md`. It covers channel and team scope, manual dispatch inputs, duplicate tickets, and failures.
For routing Slack requests to other workflows, read `skill://shipfox/create-workflow-from-template/references/slack-dispatcher.md`. It covers the workflow list, destination limits, the result handoff, duplicates, and failures.

The build also serves each template guide as a `create-workflow-from-template/references/<template-id>.md` resource. The manifest lists the SHA-256 digest and byte size of every skill file.

### Ticket to PR part contract

The [ticket to PR template](https://github.com/ShipfoxHQ/shipfox/blob/main/libs/shared/workflow/catalog/templates/ticket-to-pr/workflow.yml) composes the source part and, when the user chooses one, a tracker part. The tracker role is optional, so every tracker block must be self-contained.

The base workflow owns the `manual` trigger, the workflow outputs, and the `task` step. The `task` step reads manual inputs or the tracker's ticket and outputs `ticket_id`, `identifier`, `title`, `url`, `repository`, `reference`, `description`, `acceptance_criteria`, and `request`. The adaptation guide lists the manual inputs.

A tracker part supplies these blocks:

| Block | Required contract |
| --- | --- |
| `tracker.run_name` | Names the run from the ticket, or from the `identifier` or `title` input on a manual start. |
| `tracker.trigger` | Starts from ticket events of one team or project. It must not match the workflow's own ticket writes. |
| `tracker.load_ticket` | Adds steps before `task` that fetch ticket fields the event lacks. They fetch nothing when `trigger.source` is `manual`. Can be empty. |
| `tracker.ticket_env` | Sets `TICKET_ID`, `TICKET_IDENTIFIER`, `TICKET_TITLE`, `TICKET_URL`, `TICKET_DESCRIPTION`, and `TICKET_REQUEST` on the `task` step. Each is empty when `trigger.source` is `manual`. It can also set `TICKET_REFERENCE`, the PR body line that links a task with a ticket ID, for event and manual starts. Without it, the line is `Fixes <identifier>`. |
| `tracker.read_tools` | Gives the `fix` step read-only tracker tools. |
| `tracker.mark_in_progress` | Moves a ticket to its in-progress status before the `fix` step when the default `comment_and_transition` choice is selected. |
| `tracker.ask_questions` | Adds an `ask_questions` step for each `ticket_write_back` choice that writes. It runs only for `needs_clarification` when `steps.task.outputs.ticket_id` is set. |
| `tracker.write_back` | Adds the write-back jobs for each `ticket_write_back` choice that writes. They run only after a PR opens for a task with a ticket ID. |

The source part supplies these blocks:

| Block | Required contract |
| --- | --- |
| `source.checkout` | Grants repository write access for ordered push steps. |
| `source.prepare` | Fails when `steps.task.outputs.repository` names another repository, or another run has a branch for the identifier. Outputs `branch`, `base`, `repository`, `owner`, and `repo`. |
| `source.push` and `source.open_pr` | Push the branch and open the PR with `steps.task.outputs.reference` in its body. `open_pr` outputs `pr_number` and `pr_url`. |
| `source.feedback_listener` | Matches only the opened PR and stops when it closes. |
| `source.checkout_pr_branch`, `source.respond`, `source.push_feedback`, and `source.reply` | Check out the PR branch, handle review comments and failed CI, push, and reply. |

A tracker on the source provider, such as GitHub issues, binds the project's source connection with `# bind:source`. Its trigger filter must match only the project's repository.

The `implement` job publishes task, PR, and branch outputs. The feedback listener uses them to match one PR and check out its branch.

Keep provider tool IDs, event names, payload paths, and connection bindings inside parts. The base workflow owns job order, test gates, options, and the agent prompts. Every provider combination and structural option passes the API catalog conformance test before it ships.

## Development

```sh
turbo check --filter=@shipfox/workflow-templates
turbo type --filter=@shipfox/workflow-templates
turbo test --filter=@shipfox/workflow-templates
turbo build --filter=@shipfox/workflow-templates
turbo depcruise --filter=@shipfox/workflow-templates
```

The composition tests use `@shipfox/workflow-document` to parse every fixture role combination. They also enforce the 64 KiB composed payload limit.

## License

MIT
