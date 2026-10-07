# Workflow Document

Input shape for Shipfox workflow authoring.

## What it does

- `workflowDocumentSchema` defines the accepted Zod shape for a workflow document.
- `parseWorkflowDocument` parses unknown input into a typed `WorkflowDocument`.
- `InvalidWorkflowDocumentError` reports invalid input with the original Zod error as `cause`.
- `WorkflowDocumentRunStepGate` describes the step `gate` block with `success`
  and `on_failure`.
- A job step is a **run step** (`run: <shell command>`), an inline **agent
  step** (`prompt`), a **checkout step** (`checkout`), a **tool step**
  (`tool`), or an **action step** (`uses`). A step carries one kind, never
  multiple kinds.
- `parseWorkflowActionRef` classifies an action step's `uses` as a repository
  path or a registry reference.
- `actionManifestSchema` defines the `action.yml` manifest of a repository
  action. `buildActionManifestJsonSchema` projects it for editors.
- `encodeActionBundle` and `decodeActionBundle` store an action directory as
  one content-addressed bundle, so the API and the runner agree on its digest.

Use this package where Shipfox accepts a workflow object from a file, tool, or
API call. It checks the shape only. It does not add defaults, pick runners,
check job links, save data, or run jobs.

Keep it near the edge of the system. If the value is good, pass it to the next
layer. If the value is bad, show the fields from the Zod error to the user.

## Installation

```sh
pnpm add @shipfox/workflow-document
```

## Usage

```ts
import {InvalidWorkflowDocumentError, parseWorkflowDocument} from '@shipfox/workflow-document';

try {
  const document = parseWorkflowDocument({
    name: 'simple build',
    triggers: {
      main_push: {
        source: 'github_acme',
        event: 'push',
        filter: 'event.ref == "refs/heads/main"',
      },
    },
    jobs: {
      build: {
        checkout: {
          permissions: {contents: 'read'},
          'persist-credentials': true,
        },
        env: {NODE_ENV: 'test'},
        runner: 'ubuntu-latest',
        steps: [{run: 'npm run build', env: {CI: true}, gate: {success: 'step.exit_code == 0'}}],
      },
    },
  });

  document.jobs.build.steps[0]?.run; // "npm run build"
} catch (error) {
  if (error instanceof InvalidWorkflowDocumentError) {
    error.code; // "invalid-workflow-document"
    error.validationError.issues; // Zod issues for presentation boundaries
  }

  throw error;
}
```

A step can also be an inline agent step. It declares a `prompt` and no `run`.
`model`, `harness`, `thinking`, `provider`, `tools`, and `integrations` are optional
authoring hints; later layers resolve omitted values before the runner executes
the step. The `provider` names the model's provider (for example `anthropic` or
`openai`); pairing it with `model` lets a step target a non-default
provider/model pair. The recommended pattern is an agent step that produces a
change, followed by a `run` step whose `gate` judges the result:

```ts
parseWorkflowDocument({
  name: 'agent build',
  jobs: {
    fix: {
      steps: [
        {prompt: 'Fix the failing tests.'},
        {model: 'gpt-5.5-pro', provider: 'openai', prompt: 'Review the fix.'},
        {run: 'npm test', gate: {success: 'step.exit_code == 0'}},
      ],
    },
  },
});
```

Integration tools are selected with an `integrations` block on an agent step.
This package validates the shape only: non-empty selections, optional connection
and boolean write opt-in. Catalog checks, wildcard expansion, connection lookup,
and write-safety rules belong to later layers.

```ts
parseWorkflowDocument({
  name: 'triage',
  jobs: {
    inspect: {
      steps: [
        {
          harness: 'claude',
          tools: ['Read', 'Grep'],
          prompt: 'Triage the pull request and comment with the next action.',
          integrations: [
            {
              connection: 'github-main',
              include: ['issue_read.get', 'pull_request_read.get_files'],
              exclude: ['actions_run_trigger.run_workflow'],
              allow_write: false,
            },
          ],
        },
      ],
    },
  },
});
```

A tool step invokes an integration tool by literal id. Use `family.method` for
a method in a tool family. Tool input strings can use workflow expressions, and
tool output values map names to one expression over `result` or `vars`:

```ts
parseWorkflowDocument({
  name: 'issue summary',
  jobs: {
    inspect: {
      steps: [
        {
          tool: 'issue_read.get',
          connection: 'github-main',
          with: {owner: 'acme', repo: 'platform', number: 42},
          outputs: {title: '${{ result.title }}'},
        },
      ],
    },
  },
});
```

An action step runs a repository action. Action steps are off by default; pass
`{actions: true}` to accept them. Without it, `uses` fails with "Action steps
(`uses`) are not supported yet."

Registry references (`uses: shipfox/slack-thread-digest@1.4.2`) are off by
default too; pass `{actions: true, registryActions: true}` to accept them.
Without `registryActions`, every registry form fails with "Remote actions are
not supported yet". `parseWorkflowActionRef(uses)` returns the parsed
reference, `{kind: 'local', path}` or `{kind: 'registry', namespace, name,
version}`, or the message for an invalid value.

```ts
parseWorkflowDocument(
  {
    name: 'investigate',
    jobs: {
      investigate: {
        steps: [
          {
            key: 'thread',
            uses: './.shipfox/actions/slack-thread',
            connections: {slack: 'team-slack'},
            with: {channel_id: '${{ event.channel }}', token: '${{ secrets.SLACK_TOKEN }}'},
          },
        ],
      },
    },
  },
  {actions: true},
);
```

The action manifest has its own schema:

```ts
import {actionManifestSchema} from '@shipfox/workflow-document';

const manifest = actionManifestSchema.parse({
  name: 'Slack thread to Markdown',
  main: 'index.ts',
  inputs: {channel_id: {required: true}},
  outputs: {message_count: {type: 'number', required: true}},
  integrations: {slack: {provider: 'slack', include: ['read_thread']}},
});

manifest.inputs?.channel_id?.type; // "string"
manifest.integrations?.slack?.allow_write; // false
```

Jobs may also declare checkout intent. `permissions.contents` accepts `read` or
`write`; `persist-credentials` accepts a boolean. Both fields are optional in
the document shape. Later layers resolve omitted values to read-only checkout
with persisted credentials enabled.

```ts
parseWorkflowDocument({
  name: 'release',
  jobs: {
    publish: {
      checkout: {
        permissions: {contents: 'write'},
        'persist-credentials': false,
      },
      steps: [{run: 'pnpm release'}],
    },
  },
});
```

### Action bundles

An action bundle holds the UTF-8 text files of one action directory. The
encoder writes canonical JSON, `{"files":[{"content":"…","path":"action.yml"}],"version":1}`,
with NFC-normalized paths in code-unit order. The digest is
`sha256:<hex>` over that JSON, and the stored form is the same JSON gzipped.

```ts
import {decodeActionBundle, encodeActionBundle} from '@shipfox/workflow-document';

const bundle = await encodeActionBundle({
  files: [
    {path: 'action.yml', content: 'name: Hello\nmain: index.ts\n'},
    {path: 'index.ts', content: 'export default 1;\n'},
  ],
});
bundle.digest; // "sha256:..."

const files = await decodeActionBundle({gzip: bundle.gzip, digest: bundle.digest});
```

- File order does not change the digest. Paths must be relative, with no empty,
  `.`, or `..` segments and no backslashes; paths that collide after
  normalization are rejected.
- `decodeActionBundle` throws `InvalidActionBundleError` when the data is not
  gzip, the digest does not match, or the JSON is not in canonical form.
- The codec uses Web Crypto and `CompressionStream`, so it runs in Node and in
  browsers.

## Behavior notes

- The public contract is the Zod schema and the TypeScript types built from it.
- Workflow and job `name` fields must be literal and reject `${{ ... }}`. Put
  runtime interpolation in `run_name` or `execution_name`; write a literal
  `${{` as `$${{`.
- Bad input throws a typed `Error`; UI or API code can read `validationError.issues` for field details.
- The `checkout` block is checked as input shape here. Default resolution,
  permission capping, credential minting, and runner checkout behavior belong to
  later layers.
- The `gate` block is checked as input shape here. CEL parsing and restart
  target checks belong to definitions-owned model code.
- A step is discriminated by which keys it carries: `run` marks a run step;
  `prompt`, `model`, `harness`, `thinking`, `provider`, `tools`, or
  `integrations` mark an agent step; `checkout` marks a checkout step; and
  `tool` marks a tool step. An agent step must include `prompt`. Declaring
  fields from multiple kinds, or neither kind, is rejected. `model`, `harness`,
  `thinking`, `provider`, `tools`, and `integrations` are valid only on an agent
  step. `thinking` is validated against a fixed set (`off`, `minimal`, `low`,
  `medium`, `high`, `xhigh`, `max`, `default`). `default` requests the provider's
  default thinking without workspace or deployment overrides. When omitted,
  `thinking` uses configured defaults or `xhigh`. Provider, model, tool, integration
  connection, and integration catalog checks belong to the model layer, not
  this parser. The `agent` key is reserved for a future step kind and is
  rejected today. Tool steps accept literal `tool` and `connection` names,
  JSON-tree `with` inputs, and output mappings. `connection` defaults to the
  project source when omitted. Tool input maps are limited to 32768 serialized
  bytes and 16 nesting levels, and their `method` key is rejected. Tool output
  mappings must use one `${{ ... }}` expression over `result` or `vars`; exact
  expression and catalog checks belong to the model layer.
- Action steps accept a normalized repository path that starts with `./`,
  with no empty, `.`, or `..` segments, and, with `registryActions`, a
  registry reference `namespace/name@MAJOR.MINOR.PATCH`. Namespaces and names
  are 2 to 40 lowercase letters, digits, and single hyphens. Absolute paths,
  paths outside the repository, and URLs are rejected. With `registryActions`,
  a first segment that contains `.` or `:` fails with "Other registries are not
  supported yet", `namespace/name` without an exact version fails with "Pin an
  exact version", and three or more segments fail with "Remote actions come
  from the registry, not from Git". An action step also accepts `connections`, `with`, `key`, `name`, `if`,
  `env`, `working_directory`, and `gate`. It rejects `run`, agent fields,
  `checkout`, `tool`, `connection`, and `outputs`, because the manifest owns
  outputs. `with` has the tool-step size and depth limits, and a secret
  reference must be the whole value of a top-level input, such as
  `${{ secrets.NPM_TOKEN }}`. Manifest, binding, and input checks belong to the
  model layer.
- `buildWorkflowJsonSchema()` omits `uses` and `connections` unless called
  with `{actions: true}`.
- The manifest requires `name` and `main`. `main` is a `.ts`, `.mts`, `.js`, or
  `.mjs` path inside the action directory, without `./`. Inputs and outputs
  use the step output types (`string`, `number`, `boolean`, `json` with an
  optional JSON Schema) and default to `string` and not required. An input
  `default` must match its type. Integration selectors name tools explicitly;
  `*` is rejected. Optional `keywords` (up to 10 slugs) and `related`
  (registry package names, such as `shipfox/slack-thread-digest`) feed the
  registry page; local actions ignore them. Unknown keys are rejected
  everywhere.
- Job `outputs` and top-level workflow `outputs` map names to template strings
  and allow up to 128 entries each. Expression and job reference checks belong
  to the model layer.
- A run, agent, action, or tool step can set `export: true` or
  `export: [names]` to promote its outputs to job outputs of the same name. The
  step needs a `key`, and a checkout step rejects `export`. The model layer
  checks the names against the step's declared outputs.
- `env` can be declared on the workflow, a job, or a run step. Values may be
  strings, numbers, or booleans; the model layer stringifies numbers and
  booleans before a run is saved. Values are literal. Expression interpolation
  such as `${{ ... }}` is not evaluated.
- Each `env` map can define up to 128 entries and must serialize to 32768 bytes
  or less as JSON. The limit is checked separately at workflow, job, and run-step
  scope before the model layer copies merged env into saved run-step config.
- `env` applies only to run steps. Declaring `env` directly on an agent step is
  rejected. Workflow-level and job-level `env` is not applied to agent steps.
- Run-step env is plaintext, non-secret configuration. Values are stored in the
  committed workflow file and in the saved step config, and they are not masked.
  Do not put secrets in `env`.
- Env precedence is workflow, then job, then step; the nearest scope wins. A run
  step inherits the runner process environment, and workflow env can override
  names such as `PATH` for that subprocess. This is within the run-step trust
  boundary because the workflow author already controls the shell script.
- There is no unset syntax. `env: {}` does not remove inherited variables, and
  `FOO: ""` sets `FOO` to an empty string.
- Rules that need a project, user, runner, database row, or saved state belong
  outside this package.

This package answers one question: does this value have the right fields. The
next layer can then decide what those fields mean. Keeping that split clear
makes errors easier to show and tests easier to read.

A file can come from a person, a tool, or a form. This part checks it before any
other part uses it. Good data moves on. Bad data stops close to where it came
from. That gives the caller a clear place to show what must change.

This keeps the first step fast and easy to use. It also lets later code work
with a value that has already passed the basic shape check.

Use it at the start of a flow. Do not wait until save time. The sooner this
part runs, the easier it is to tell the caller what is wrong and ask for a
small fix.

## Development

```sh
turbo build --filter=@shipfox/workflow-document
turbo check --filter=@shipfox/workflow-document
turbo type --filter=@shipfox/workflow-document
turbo test --filter=@shipfox/workflow-document
```

## License

MIT
