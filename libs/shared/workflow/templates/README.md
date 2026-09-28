# Workflow templates
A library for composing first-party workflow templates from embedded YAML and Markdown assets.

## What it does

- **`workflowTemplateManifestSchema`** checks template presentation fields, keywords, starts, flow, writes, prerequisites, related templates, roles, options, model placeholders, and described slots, secrets, and variables.
- **`composeWorkflow`** replaces `# part:<role>.<name>` markers with text blocks at the marker indentation.
- **`composeTemplate`** selects one provider part for every bound role, composes the workflow, and writes its `# shipfox-template:` header.
- **`templateRoleBindings`** lists every role binding a template supports, with each optional role both bound and unbound.
- **`extractModelAnchors`** reads each placeholder's tested model and thinking setting from composed YAML.
- **`recommendModels`** selects up to four scored alternatives to a tested model and labels their intelligence and cost tradeoffs.
- **`buildTemplatePrompt`** builds the prompt a user pastes into a coding agent to set up a template. It is also exported from the browser-safe `@shipfox/workflow-templates/prompt` subpath.
- **`createTemplateLoader`** creates an injectable loader for tests or other asset sources. Each loaded template reports its identity and embedded compatibility values beside the manifest, plus `startsManually`.
- **`shippedTemplateLoader`** serves only assets embedded during the package build.
- **`listShippedSkillResources`** lists the embedded skill index, manifest, procedures, and references.
- **`getShippedSkillResource`** reads one embedded resource by its exact `skill://shipfox/` URI.

The package does not evaluate expressions or implement conditionals and loops. It keeps template comments in the composed YAML so the coding agent can use binding, slot, and option instructions.

## Installation and setup

```sh
pnpm add @shipfox/workflow-templates
```

The package build reads `assets/skills/` and template directories from `assets/`. It embeds the skill files, manifests, workflows, guides, and provider parts into a generated TypeScript module. The API image therefore does not copy these files at runtime.

## Usage

```ts
import {composeWorkflow} from '@shipfox/workflow-templates';

const workflowYaml = composeWorkflow(
  ['jobs:', '  build:', '    # part:source.checkout'].join('\n'),
  {checkout: '- key: checkout\n  prompt: Check out the repository.'},
);
```

Tests can inject a fixture with `createTemplateLoader`. Fixture files live under the package `test/` directory, including the [fixture guide](test/fixtures/GUIDE.md). The shipped loader never reads or returns those files.

## Behavior notes

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
- `# shipfox-template: <id>@<revision> <role>=<provider>` identifies an adopted composed template. `composeTemplate` writes it after leading comments from the loader identity and bound roles, so base workflows must not declare it.

The composer only substitutes `part:` markers. It does not evaluate expressions, conditionals, or loops. A missing part or required provider binding throws an error.

Each `models` entry needs a matching marker in `workflow.yml` or a provider part. The entry can include a `note` for the user. The loader composes every role binding and rejects missing, unknown, incomplete, or conflicting markers. Keep model markers out of optional-role parts, because the composition without that role would lose them.

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

- `writes` lists every write the template can make, as `{provider?, action}`. Put conditions in the sentence, such as "With a tracker, comments on the ticket." Omit `provider` when it depends on the user's choice.
- `prerequisites` lists user actions that the roles do not imply, such as inviting the Shipfox app to a channel. Do not list connections: binding each role already requires one.
- `related` holds registry package names, such as `shipfox/fix-dependency-ci`.

Neither list carries conditions. Consumers show them as authored, and the coding agent applies them to the user's choices.

### Setup prompts

`buildTemplatePrompt({templateId, choices})` returns `Use Shipfox to create a workflow from the <id> template.` Each `choices` clause, such as `with Slack as the report` or `without the tracker part`, is appended, so the create-workflow-from-template skill confirms it instead of asking. Browser code imports it from `@shipfox/workflow-templates/prompt`, because the package root embeds every template asset.

### Model recommendations

`recommendModels({anchor, models})` takes a scored, resolved template anchor and the workspace catalog. It considers only models with a lab on the anchor's scale and within ten intelligence-index points, and excludes every thinking level of the anchor's model. It first selects the cheapest cheaper alternative (within three points below the anchor), then the cheapest model more than three points smarter, and fills up to four alternatives by score proximity while preferring labs not yet represented. A selected model removes all of its thinking levels from later slots. Results are ordered by intelligence index, highest first, and each result includes dimension-specific intelligence and cost tradeoff keys and display copy.

### Asset layout

A shipped asset uses this layout:

```text
assets/skills/<skill-name>/SKILL.md
assets/skills/<skill-name>/references/*.md
assets/<template-id>/
  template.yaml
  workflow.yml
  GUIDE.md
  parts/<role>/<provider>.yml
embedded-templates.yaml
```

To check a local workflow without starting a run, read `skill://shipfox/validate-workflow-change/SKILL.md` through MCP. It covers trigger inputs, retained events, dry-run refusals, and verification.

To run a validated change against a real trigger, read `skill://shipfox/test-workflow-change/SKILL.md` through MCP. It covers side effects, run inspection, retries, and checkout order.

Each part file is a YAML map from part name to a literal text block. The source role can declare `from: project` so later consumers resolve its provider from the selected project. A template without such a role, such as `report-failed-runs`, still takes a project but binds no project-specific source connection.

Provider tool IDs, event names, and connection bindings belong in parts. The one exception is the built-in `shipfox` connection, which exists in every workspace: `workflow.yml` can bind it directly with `source: shipfox` and `connection: shipfox`.

Shipped templates keep an adaptation guide beside their workflow. For pull request CI repair, read `skill://shipfox/create-workflow-from-template/references/fix-dependency-ci.md` through MCP. It covers prerequisites, PR selection, repair limits, choices, and customization slots.
For Slack codebase questions, read `skill://shipfox/create-workflow-from-template/references/ask-codebase.md`. It covers channel scope, manual dispatch inputs, and outcomes.
For default-branch CI failures, read `skill://shipfox/create-workflow-from-template/references/fix-default-branch-ci.md`. It covers duplicate limits, outcomes, and the optional Slack report.
For failed run reports, read `skill://shipfox/create-workflow-from-template/references/report-failed-runs.md`. It covers run event filters, options, and Slack writes.
For tasks to pull requests, read `skill://shipfox/create-workflow-from-template/references/ticket-to-pr.md`. It covers manual task inputs, workflow outputs, the optional tracker, and expected writes.
For Slack conversations that become tickets, read `skill://shipfox/create-workflow-from-template/references/slack-to-ticket.md`. It covers channel and team scope, manual dispatch inputs, duplicate tickets, and expected writes.
For routing Slack requests to other workflows, read `skill://shipfox/create-workflow-from-template/references/slack-dispatcher.md`. It covers the workflow list, destination limits, the result handoff, duplicates, and expected writes.

The build also serves each template guide as a `create-workflow-from-template/references/<template-id>.md` resource. The manifest lists the SHA-256 digest and byte size of every skill file.

### Ticket to PR part contract

The [ticket to PR template](https://github.com/ShipfoxHQ/shipfox/blob/main/libs/shared/workflow/templates/assets/ticket-to-pr/workflow.yml) composes the source part and, when the user chooses one, a tracker part. The tracker role is optional, so every tracker block must be self-contained.

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
