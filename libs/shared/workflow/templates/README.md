# Workflow templates
A library for composing first-party workflow templates from embedded YAML and Markdown assets.

## What it does

- **`workflowTemplateManifestSchema`** checks template identity, revisions, roles, provider choices, options, slots, secrets, and variables.
- **`composeWorkflow`** replaces `# part:<role>.<name>` markers with text blocks at the marker indentation.
- **`composeTemplate`** selects one provider part for every manifest role and composes the workflow.
- **`modelTiers`** stores the ordered model preferences for each profile and step role.
- **`resolveModel`** selects the first preferred model available in a workspace catalog.
- **`createTemplateLoader`** creates an injectable loader for tests or other asset sources.
- **`shippedTemplateLoader`** serves only assets embedded during the package build.
- **`getSetupGuide`** returns the versioned, first-party [workflow setup playbook](https://github.com/ShipfoxHQ/shipfox/blob/main/libs/shared/workflow/templates/assets/playbook.md).

The package does not evaluate expressions or implement conditionals and loops. It keeps template comments in the composed YAML so the coding agent can use binding, slot, and option instructions.

## Installation and setup

```sh
pnpm add @shipfox/workflow-templates
```

The package build reads `assets/playbook.md`, `assets/model-tiers.yaml`, and template directories from `assets/`. It embeds the playbook, manifests, workflows, guides, provider parts, and model preferences into a generated TypeScript module. The API image therefore does not copy template files at runtime.

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
- `# option:X=Y begin` and `# option:X=Y end` surround an optional block.
- `# shipfox-template: <id>@<revision> <role>=<provider>` identifies an adopted composed template.

The composer only substitutes `part:` markers. It does not evaluate expressions, conditionals, or loops. A missing part or provider binding throws an error.

### Model profiles

`model-tiers.yaml` defines the `balanced`, `economy`, and `strongest` profiles. Each profile lists preferences for `mechanical`, `implementation`, and `review` steps. `resolveModel` checks those preferences in order against the model IDs available to a workspace and returns `null` when none match.

### Asset layout

A shipped asset uses this layout:

```text
assets/playbook.md
assets/<template-id>/
  template.yaml
  workflow.yml
  GUIDE.md
  parts/<role>/<provider>.yml
```

Each part file is a YAML map from part name to a literal text block. The source role can declare `from: project` so later consumers resolve its provider from the selected project.

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
