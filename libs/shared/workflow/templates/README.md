# Workflow templates
A library for composing first-party workflow templates from embedded YAML and Markdown assets.

## What it does

- **`workflowTemplateManifestSchema`** checks template identity, revisions, roles, provider choices, options, model placeholders, slots, secrets, and variables.
- **`composeWorkflow`** replaces `# part:<role>.<name>` markers with text blocks at the marker indentation.
- **`composeTemplate`** selects one provider part for every manifest role and composes the workflow.
- **`suggestModels`** orders measured model and thinking combinations for a template placeholder.
- **`createTemplateLoader`** creates an injectable loader for tests or other asset sources.
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
- `# option:X=Y begin` and `# option:X=Y end` surround an optional block.
- `# shipfox-template: <id>@<revision> <role>=<provider>` identifies an adopted composed template.

The composer only substitutes `part:` markers. It does not evaluate expressions, conditionals, or loops. A missing part or provider binding throws an error.

Each `models` entry needs a matching marker in `workflow.yml` or a provider part. The entry can include a `note` for the user.

An optional `reference: {model, thinking}` records the exact setting the template author tested. The catalog conformance test checks the model and its supported thinking levels. Leave `reference` out until the author tests the step with that setting.

### Model suggestions

`suggestModels` compares scored combinations with the exact model and thinking setting the template author tested. It suggests the cheapest combination that meets or exceeds that setting's measured intelligence index. The user confirms the complete provider, model, harness, and thinking binding.

If the tested setting has no score or the measured scales differ, `suggestModels` lists supported combinations without a suggestion. Choices with no score remain available for manual selection.

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
```

To check a local workflow without starting a run, read `skill://shipfox/validate-workflow-change/SKILL.md` through MCP. It covers trigger inputs, retained events, dry-run refusals, and verification.

To run a validated change against a real trigger, read `skill://shipfox/test-workflow-change/SKILL.md` through MCP. It covers side effects, run inspection, retries, and checkout order.

Each part file is a YAML map from part name to a literal text block. The source role can declare `from: project` so later consumers resolve its provider from the selected project.

Shipped templates keep an adaptation guide beside their workflow. For dependency-bot CI, read `skill://shipfox/create-workflow-from-template/references/fix-dependency-ci.md` through MCP. It covers prerequisites, choices, and customization slots.

The build also serves each template guide as a `create-workflow-from-template/references/<template-id>.md` resource. The manifest lists the SHA-256 digest and byte size of every skill file.

### Ticket to PR part contract

The [ticket to PR template](https://github.com/ShipfoxHQ/shipfox/blob/main/libs/shared/workflow/templates/assets/ticket-to-pr/workflow.yml) composes one tracker part and one source part. Later tracker providers must supply these blocks:

| Block | Required contract |
| --- | --- |
| `tracker.trigger` | Starts from that tracker's ticket event and filters unrelated updates. |
| `tracker.read_ticket` | Adds a `ticket` agent step with `summary` and `identifier` string outputs. |
| `tracker.write_back` | Adds a `write_back` step that comments with the opened PR URL. |
| `tracker.transition` | Adds an optional `transition_ticket` step for the chosen ticket status. |

The source part supplies these blocks:

| Block | Required contract |
| --- | --- |
| `source.checkout` | Grants repository write access for ordered push steps. |
| `source.push` | Creates a branch and outputs `branch`, `base`, `repository`, `owner`, and `repo`. |
| `source.open_pr` | Creates the PR and outputs `pr_number` and `pr_url`. |
| `source.review_listener` and `source.ci_listener` | Match only the opened PR and stop on close, timeout, or execution cap. |
| `source.checkout_pr_branch` and `source.push_feedback` | Check out and update the PR branch. |
| `source.repair_ci` and `source.reply_to_review` | Read failed CI logs or reply to a review comment. |

The `implement` job publishes PR identity and branch outputs. Each listener uses those outputs to match one PR and check out its branch.

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
