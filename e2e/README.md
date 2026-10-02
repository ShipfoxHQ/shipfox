# E2E Testing

This subtree owns Shipfox end-to-end tests and their shared authoring tools. Use
this guide to decide where a test belongs, how setup is allowed to work, and what
reviewers should enforce.

For repository-wide unit-test, Storybook, and visual-regression rules, read the
[testing guide](../docs/guides/testing.md). This README owns the E2E-specific
suite architecture, setup model, screens, drivers, and review constraints.

## Directory Map

E2E code has two axes: layer and suite level.

Layers flow downward only:

```text
suites -> kit / screens -> setup / observe / drivers -> core
```

What lives where:

| Directory | Package shape | Purpose |
| --- | --- | --- |
| `core/` | `@shipfox/e2e-core` | Transport, environment config, preflight checks, `pollUntil`, API clients, and the shared Playwright re-export. |
| `setup/` | `@shipfox/e2e-setup-<module>` | Data setup helpers backed by module-owned `/__e2e/<module>` HTTP routes. |
| `observe/` | `@shipfox/e2e-observe-<module>` | Public API pollers and readers used to wait for platform-visible state. |
| `drivers/` | `@shipfox/e2e-driver-<name>` | Sanctioned HTTP bypasses for external systems or local processes, such as Gitea and runner processes. |
| `kit/` | `@shipfox/e2e-kit` | Authoring ergonomics: config factories, shared setup, fixture presets, app-shell page objects, and stable screenshots. |
| `screens/` | `@shipfox/e2e-screens-<domain>` | Per-domain browser page objects, typed against Playwright but emitted without Playwright runtime imports. |
| `suites/` | `@shipfox/e2e-<level>-<surface>` | The actual Playwright specs. Suites consume the lower layers; they do not provide reusable helpers to other suites. |

Suite levels are independent from layers:

| Level | Use it for |
| --- | --- |
| `suites/client/*` | Browser tests that drive the UI or assert user-visible page state. |
| `suites/api/*` | HTTP-only tests that assert API contracts without a browser. |
| `suites/flow/*` | Full platform loops that need VCS push, webhook delivery, definition sync, Temporal, runner capacity, step execution, and logs. |
| `suites/eval/*` | Repeatable workflow-template and onboarding evaluations that run through the E2E stack and write scored results. |

Driver-specific docs live with their drivers:

- [`drivers/gitea/README.md`](drivers/gitea/README.md) explains direct Gitea admin/API usage.
- [`drivers/github/README.md`](drivers/github/README.md) explains the fake GitHub API.
- [`drivers/linear/README.md`](drivers/linear/README.md), [`drivers/slack/README.md`](drivers/slack/README.md), [`drivers/discord/README.md`](drivers/discord/README.md), [`drivers/clickup/README.md`](drivers/clickup/README.md), [`drivers/jira/README.md`](drivers/jira/README.md), [`drivers/notion/README.md`](drivers/notion/README.md), and [`drivers/posthog/README.md`](drivers/posthog/README.md) explain the other provider fakes and their event senders.
- [`drivers/runner-process/README.md`](drivers/runner-process/README.md) explains local runner and provisioner processes.
- [`suites/flow/workflows/README.md`](suites/flow/workflows/README.md) is the deep runbook for the workflow flow suite.

## Workflow flow scenarios

The workflow flow suite accepts an optional `child_run` block in `expect.yaml`
when a `tool:` step starts another workflow:

```yaml
child_run:
  workflow: .shipfox/workflows/child.yml
  depth: 1                 # parent links to follow; defaults to 1
  status: succeeded        # succeeded | failed | cancelled
  parent_run: true         # require a recorded parent run
  jobs:                    # optional, the same job/step assertions as the parent
    build:
      status: succeeded
```

A scenario using this assertion may include `child-workflow.yml` beside its
`workflow.yml`. The harness commits both files, then seeds matching VCS
definitions through the API, including the child at
`.shipfox/workflows/<scenario>-child.yml`; `workflow` names that definition.
The harness follows `parent_run` links `depth` times, waits for the selected run
to reach a terminal state, and checks its parent, terminal status, and optional
jobs. A deeper descendant can therefore assert a self-starting workflow stopping
with `run-depth-exceeded` without adding a bespoke test.

Use a `triggered_run` block instead when the scenario run's events start
another workflow through its trigger, for example `source: shipfox` on
`run.completed`:

```yaml
triggered_run:
  workflow: .shipfox/workflows/<scenario>-child.yml
  status: succeeded
  trigger:                 # the source and event that started the run
    source: shipfox
    event: run.completed
  jobs:                    # optional, the same job/step assertions as the parent
    deploy:
      status: succeeded
```

The harness seeds `child-workflow.yml` the same way, waits for the first run of
that definition other than the scenario run, and checks its terminal status,
trigger, and optional jobs. Workflows can use `__PROJECT_NAME__` to filter
events on the scenario's project, because every scenario shares one workspace.

## Pick the Right Level

Use this decision tree before adding a spec:

1. Does the test need to drive a browser or assert user-visible UI?
   Put it in `suites/client/<surface>`.
2. Does it only need to assert an HTTP contract, validation result, auth behavior, or API response?
   Put it in `suites/api/<surface>`.
3. Does it need the full product loop: VCS push, org webhook, definition sync, trigger dispatch, Temporal orchestration, a runner, step execution, and log capture?
   Put it in `suites/flow/<surface>`.
4. Does it repeat cases, compare quality across runs, or evaluate onboarding rather than report one pass/fail flow?
   Put it in `suites/eval/<surface>`.
5. Can the full-loop case be expressed as data?
   Prefer one scenario directory with `workflow.yml` plus `expect.yaml` or `reject.yaml`. Add a bespoke Playwright spec only when the case must orchestrate from outside the run, such as cancellation or listener behavior.

Do not use a browser test to prove a pure HTTP contract. Do not use a flow test
when a browser or API test proves the behavior at a lower cost.

## Setup Is HTTP-First

Tests create product data through module-owned setup routes:

```text
/__e2e/<module>
```

Each setup route is mounted only when `E2E_ENABLED=true` and
`E2E_ADMIN_API_KEY` is set. Test code reaches those routes through an
`@shipfox/e2e-setup-<module>` helper. Do not create E2E data through direct
database access.

Add a new setup helper only when the owning product module exposes the matching
`/__e2e/<module>` route. Keep route DTOs shared through the module's public DTO
package when the helper needs typed request or response contracts.

`drivers/*` is the only sanctioned bypass from product HTTP:

- `drivers/gitea` talks directly to the local Gitea instance because Gitea is the external system under integration.
- `drivers/github`, `drivers/linear`, `drivers/slack`, `drivers/clickup`, `drivers/jira`, and `drivers/notion` fake their provider's API because each provider is the external system under integration. Each fake exposes `writes()`, the state-changing requests it accepted.

  The API reads one address per provider, so the harness starts a small router there, and each spec runs its own fake on a private port and registers the credential the API presents to it (an access token, or the installation for GitHub). The router sends a request to the fake that registered its credential, so specs that use the same provider run in parallel and each fake records only its own calls and writes. Give each spec its own tokens. A fake started without a router, such as in a driver's unit test, passes an `endpoint` and listens there. See `harness/src/fake-router.mjs`.
- `drivers/posthog` reads and controls the read-only PostHog fake that the harness starts, through harness routes. It fakes nothing itself and has no `writes()`.
- `drivers/runner-process` starts local runner/provisioner processes because runner capacity is process infrastructure, not product data.

A new driver is justified only for an external system, host process, or local
infrastructure boundary that cannot be represented as product HTTP setup. If the
helper creates app-owned rows, it belongs under `setup/`, not `drivers/`.

## Config And Fixtures

Suites use config factories from `@shipfox/e2e-kit/config`:

```ts
import {defineClientE2eConfig} from '@shipfox/e2e-kit/config';

export default defineClientE2eConfig({buildName: 'e2e-client-secrets'});
```

Use `defineClientE2eConfig` for browser suites and `defineApiE2eConfig` for
HTTP-only suites. Do not hand-roll a Playwright config unless the factory cannot
express a real suite requirement; prefer adding a typed option to the factory.

Client suites compose the kit fixture presets instead of re-declaring the common
fixture union:

```ts
import {workspaceFixtures, type WorkspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type SecretsScreenFixtures, secretsScreens} from '@shipfox/e2e-screens-secrets';

export const test = base.extend<WorkspaceFixtures & SecretsScreenFixtures>({
  ...workspaceFixtures,
  ...secretsScreens,
});
```

Use `createReadyWorkspace` from `@shipfox/e2e-kit/fixtures` for the standard
user, workspace, and project arrangement. Specs should add only the
domain-specific fixtures and setup their behavior needs.

## Screens And App Shell

Screens are browser page objects. Each browser domain gets one
`@shipfox/e2e-screens-<domain>` package under `screens/<domain>`.

A screens package exports:

- a screen class, such as `SecretsSettingsScreen`;
- a `Fixtures` type, such as `SecretsScreenFixtures`;
- a fixture object, such as `secretsScreens`.

Screens are type-only against Playwright:

```ts
import type {Locator, Page} from '@shipfox/playwright';
```

The emitted JavaScript must not import Playwright. Screens may use `kit/ui`
primitives, `e2e-core`, and relevant DTO types. They do not import suites, other
screen packages, or runtime `@shipfox/client-*` packages.

Cross-cutting shell UI lives in `@shipfox/e2e-kit/ui`: top navigation,
workspace switcher, settings shell, dialogs, toasts, table rows, and
`stableScreenshot`. A domain screen owns product-domain navigation and actions.
For example, workspace switching shell behavior belongs in `kit/ui`; the
workspaces suite's route-specific settings and invitation screens belong in
`e2e-screens-workspaces`.

Specs should not contain raw locators for product UI. Put locators, waits,
navigation, and visual normalization behind named screen or kit UI methods so
the spec body reads as user intent.

## Granularity

One test proves one behavior:

- Keep Arrange, Act, and Assert visually separated.
- Keep tests independent and order-free.
- Assert the user-visible outcome that names the behavior.
- Use `test.step(...)` for a genuine multi-stage journey instead of splitting a journey into order-dependent tests.

One file covers one surface or one journey:

- Name files `<surface>.e2e.ts` or `<surface>-<aspect>.e2e.ts`.
- Use `test.describe('<surface or state>')` to group related behavior.
- Name tests in present tense.
- Keep setup, locators, navigation, visual normalization, and workflow templates out of spec files.
- Split by concern when a file grows beyond roughly 8 tests or roughly 150 lines of intent.

There is no line-count lint. Granularity is review-enforced because a useful
split depends on the surface, journey, and fixture shape.

Flow suites keep the same rule through data-driven scenarios: one scenario
directory is one behavior. Use `workflow.yml` plus `expect.yaml` or `reject.yaml`
by default.

## Dependencies And Enforcement

Every suite declares what it verifies so Turbo reruns the suite when the verified
surface changes.

Client suites declare:

- the runtime client packages they verify, such as `@shipfox/client-auth`;
- their screen package, such as `@shipfox/e2e-screens-auth`;
- relevant DTO packages for types and public contracts;
- `@shipfox/e2e-kit`, `@shipfox/e2e-core`, `@shipfox/playwright`;
- the `@shipfox/e2e-setup-*`, `@shipfox/e2e-observe-*`, and `@shipfox/e2e-driver-*` packages they use.

API suites declare:

- the API DTO package whose contract they verify;
- `@shipfox/e2e-kit` when using API config/setup;
- `@shipfox/e2e-core`, `@shipfox/playwright`;
- the setup or observe packages they use.

Flow suites declare:

- every API DTO package whose public response or payload they assert;
- every setup, observe, and driver package used by the scenario engine;
- `@shipfox/e2e-core`, `@shipfox/e2e-kit` when needed, and `@shipfox/playwright`;
- only the runtime app packages needed for the full loop.

E2E code depends on API DTO packages, never server API implementation packages.
Use `@shipfox/api-<module>-dto`, not `@shipfox/api-<module>`.

Dependency Cruiser enforces the structural rules:

- E2E code cannot import non-DTO `@shipfox/api-*` packages.
- Dependencies flow down the layer stack only.
- Suites cannot import other suites.
- Screens are leaf page-object packages.
- Screens may import Playwright only as type-only imports.

The root CI static verification job runs:

```sh
turbo check type build depcruise --concurrency="$SHIPFOX_TURBO_CONCURRENCY"
```

Each E2E package has its own `depcruise` task, so these rules run in the same
Turbo and CI gate as the rest of the repo.

## Visual Regression

Client E2E suites can add Argos page snapshots at user-visible checkpoints.
Prefer `stableScreenshot` from `@shipfox/e2e-kit/ui` when the page contains
dynamic text, generated IDs, volatile attributes, or toasts that need
normalization. It wraps `argosScreenshot` and restores the DOM after capture.

Capture after assertions prove the page reached the expected state:

```ts
await expect(page.getByRole('heading', {name: 'No projects yet'})).toBeVisible();
await stableScreenshot(page, 'projects/empty-state');
```

`stableScreenshot` and `argosScreenshot` wait for fonts and stable layout, but
they cannot wait for content the test has not asserted. Keep visible generated
data deterministic or normalize it before capture so Argos reports UI drift, not
random IDs or names.

Name snapshots `<surface>/<state>`, such as `auth/login` or
`projects/empty-state`. Add a snapshot to the existing test that already drives
the page to that state; do not write screenshot-only specs.

Each E2E client package sets its Argos `buildName` through
`defineClientE2eConfig`. The value must match the package name without the
`@shipfox/` scope, such as `@shipfox/e2e-client-auth` ->
`e2e-client-auth`, so each surface gets its own PR check and baseline.

## Running And Debugging

Run a suite through the repo E2E harness when it needs the API/client dev servers:

```sh
docker compose up -d
mise run e2e -- --filter=@shipfox/e2e-client-auth
```

In a Conductor worktree, local services are normally started by workspace setup.
The equivalent service command is:

```sh
pnpm dev:services:up
```

If the API and client are already running, run the package directly:

```sh
turbo test:e2e --filter=@shipfox/e2e-client-auth
```

Run pure helper or evaluator tests with `turbo test`:

```sh
turbo test --filter=@shipfox/e2e-flow-workflows
```

Workflow evaluations use the same harness, but run the Node evaluator instead
of Playwright:

```sh
mise run evals -- --suite templates --mode scripted
mise run evals -- --suite templates --mode scripted --case fixture --repeat 3
```

Each case arranges its own workspace, GitHub connection, and project on a
fake repository. A case that binds a role to Jira also gets the Jira fake and
a Jira connection. The case composes its template variant through the template
loader, binds each role to its connection's slug, and creates the definition.
A case sets every option its variant uses, because an option left out keeps
all of its blocks. Its `placeholders` map gives the `replace-with-*` placeholders
that have no slot, such as a Jira project key, the values a person would give
the coding agent. Then it starts a local runner with a label of its own. The runner
gets an empty global Git configuration, so a developer's own settings, such as
commit signing, never reach the case. It then runs the case's `scenario` in
order and writes the result to `results/<run-id>/<case>/<repeat>.json`. A case
that finishes its scenario includes the run observation. A case that errors
carries the failed step and its reason instead, with the run observation when
its scenario had started a run. A case that doesn't pass also
carries the last 200 lines of its runner log. With a script, it also carries
the model requests the script served. The exit code is non-zero when any case
errors or fails its expectations.

A case that binds a role to Slack also gets a Slack connection and a Slack
fake in its workspace. The fake serves the thread under `seed.slack.thread`,
oldest first, and records each posted message as `slack.chat.postMessage`,
targeted at its channel. The fake answers the requests that carry the case's
bot token, so cases that use Slack run together. `placeholders` fills the `replace-with-*` values a
person edits in the composed file, such as `replace-with-channel-id`, which
must name `seed.slack.channel` for a mention trigger to match.

A case with agent steps puts their model replies in `scripted.yaml`, next to
`case.yaml`. In scripted mode the runner registers it with the scripted
managed provider for the case's project, and refuses a case with agent steps
but no script. Each entry has a `match` with
`prompt_contains` and a list of `replies`, each a `text` or a `tool` call with
`args`. A step attempt's first request picks the first entry whose text it
contains. So an entry that continues a shared session goes before the entry
that started it. Each later request of that attempt reads the entry's next
reply. A pi step with declared outputs ends once it sets every output, and one
without outputs ends at a `text` reply. An integration tool's name is
`<connection slug>__<tool id>`, and the GitHub slug is `github_<owner>`. A
request that matches no entry, or finds its entry used up, fails the step, and
the case fails with the request listed.
`cases/templates/ticket-to-pr/feedback-loop` is the worked example.

A case can seed pull requests before its scenario starts, such as a
dependency bot's update. Each `seed.pull_requests` entry has a `branch`, an
optional `author` and `title`, and an optional `files` directory next to
`case.yaml`. The branch holds `repo/` with `files` laid over it, on top of the
default branch, and the fake holds an open pull request on it.
`cases/templates/fix-dependency-ci/push-fix` is the worked example.

A case that finishes its scenario is then checked against `expect`:

- `outputs`: each key must equal the run's workflow output. Other outputs are
  allowed.
- `writes`: strict. Each entry names one kind of write, such as
  `github.push: {branch: $pr.head, count: 2}`. `count` is exact and defaults
  to 1, and `count: 0` states a write that must not happen. `target` and
  `pull_request: $pr` match what the write acted on, and every other field
  matches the write's payload. A write that matches no entry fails the case as
  unexpected, and one that matches a `count: 0` entry fails it as forbidden. A
  case with no `writes` expects none. Reads are never checked. Each entry
  counts every write it matches, so entries that overlap count the same write
  twice.

The result is `failed` and lists each unmatched or missing write with its
payload. The recorded writes are in the result file.

A scenario step is one of:

- `start`: `manual` with `inputs`, or `event` with a provider event. An event
  that starts no run within 15 seconds is sent again until the step's timeout,
  because a delivery that lands before the definition's trigger is active
  starts nothing.
- `send`: a provider event, such as `github: {pull_request.closed: {...}}`.
  `$pr` and `$pr.head` in an event payload resolve to the pull request the run
  opened in the GitHub fake, or else the one the case seeded, and `$pr.url` to
  its address. Inside longer text,
  as in `Opened pull request: $pr.url`, a reference becomes its text. The
  case's GitHub fake sends `pull_request_review_comment.created`,
  `pull_request.closed`, `workflow_run.completed`, and `issues.labeled`. The case's Slack connection sends a signed `app_mention`,
  with `thread_ts` for a mention inside a thread. The Jira sender sends signed `jira:issue_created` and
  `jira:issue_updated` events, with an `issue` (`key`, `summary`, and
  optionally `id`, `status`, `project`, `labels`, and `description`) and
  optionally `previous_status` or `previous_labels` on `jira:issue_updated`,
  which become the changelog. Jira writes are recorded as `jira.add_comment`,
  `jira.transition_issue`, and so on, with the issue ID or key as the target.
  Other providers need an `EventSender` passed to `runEval`.
- `await`: a `job` status, a `listener` that is `ready`, a listener `execution`
  status, or the `run` status. A job, execution, or run that ends in another
  terminal status fails the step at once.

A case that starts from a GitHub issue loads it with `seed.github.issues`, each
with a `number`, `title`, `body`, and `labels`, into the GitHub fake. Its
`issues.labeled` event, `{issue: <number>, label: <name>}`, adds the label to
the seeded issue and delivers it again until a run starts, because a delivery
that lands before the trigger is active starts nothing.
`cases/templates/ticket-to-pr/github-label` is the worked example.

Every step takes its own `timeout_seconds`, capped by the case's
`timeout_seconds`. A case runs a fixture template instead of a shipped one when
its `catalog` names a template directory next to its `case.yaml`.

`--mode compile` checks the wiring of every template variant without running
any of them. It arranges one workspace and project, creates a connection for
each provider a variant binds (GitHub, Linear, Slack, ClickUp, and Jira),
composes each variant the way `templateVariants` lists it, binds its
connection slugs, and creates a definition. Creating a definition succeeds
even when a trigger is broken, because the endpoint stores that trigger as
inert. So a variant passes only with zero error diagnostics and with every
trigger, listening `on` matcher, and `until` matcher active in the compiled
model. `test:e2e` runs it before the scripted cases. `--case` filters by
template id, and `--catalog <directory>` compiles a catalog directory instead
of the shipped templates:

```sh
mise run evals -- --suite templates --mode compile --case 'ticket-to-pr'
```

The onboarding suite drives a real Claude Agent SDK session against the stack.
Each case in `cases/onboarding/` sets up a workspace, a fixture repository, and
a recording MCP proxy, then answers the agent's questions with a simulated user
that follows the case's `persona`. It needs `ANTHROPIC_API_KEY`, ignores
`--mode`, runs each case `k` times unless `--repeat` is set, and writes one JSON
result per repeat with the transcript, the MCP call log, the workflow files the
agent wrote, and usage:

```sh
ANTHROPIC_API_KEY=<key> mise run evals -- --suite onboarding --case ticket-to-pr-named
```

Each case declares the `expect.outcome` a correct agent ends with, and only the
checks for that outcome run. A repeat passes when every applicable check does,
and `checks` and `passed` in its result show which did not.

| Outcome | A correct agent |
| --- | --- |
| `validated` | Writes a workflow that passes a dry run, with no `replace-with-*` placeholder and only models the workspace has. |
| `blocked_on_connection` | Writes nothing, starts nothing, and names `expect.missing_provider` in its final message. |
| `needs_clarification` | Writes nothing and starts nothing. |

Every outcome also requires that the session ended on its own and, when
`expect.max_questions` is set, that the agent asked no more questions than that.
A question is a turn that ends by asking the user something, counted from the
transcript. When `expect.template` is set on a `validated` case, the runner also
checks that the header names the template and `expect.bindings`, that
`get_workflow_template` succeeded before the file was written, and that the file
matches the template composed with `expect.bindings` and `expect.options`. Options
the case leaves out take the manifest default. The comparison allows filled
`# slot:` markers, `# option:` lines, connection slugs after `# bind:`, and model
lines. The runner makes the dry run itself, through the proxy after the session
ends, so it never appears in the agent's call log.

Evaluations also export to Langfuse when `LANGFUSE_PUBLIC_KEY` and
`LANGFUSE_SECRET_KEY` are set. `LANGFUSE_BASE_URL` selects the region and
defaults to the EU cloud. Each `<suite>/<mode>` is one experiment, and each
case and repeat is one item. Without the keys, only local results are written.
Onboarding results are local-only for now.

`exportClaudeTranscript` in `@shipfox/e2e-eval-workflows` turns a Claude session
transcript into one generation per model call and one tool span per tool call,
nested under the active Langfuse span. Timestamps come from the transcript, and
the raw JSONL is attached as media.

The managed provider fixture can send a project's model calls to OpenRouter
instead of answering with fixed text or a script. Set `E2E_OPENROUTER_API_KEY`
for the harness, then register the project with `registerOpenRouterManagedProvider`
from `@shipfox/e2e-setup-agent`. It serves the catalog models named in
`apps/api/src/e2e-openrouter.ts` as OpenAI chat completions and records their
tokens as usage. The flow test `openrouter-managed-provider.e2e.ts` covers it,
skips without the key, and spends real money, so run it by hand:

```sh
E2E_OPENROUTER_API_KEY=<key> mise run e2e -- --filter=@shipfox/e2e-flow-workflows
```

Live mode runs the cases that declare `modes: [live]` through that OpenRouter
backend, so it needs the same key for the harness. It spends real money, so run
it by hand. `--repeat` runs each case that many times, and
`--max-cost-usd` stops starting new case runs once the runs so far have cost
that much. The cost is what OpenRouter reported for the case's model requests.
Each result carries its `measures`: the tokens from the usage route, and the
gate retries, which are the step attempts after each step's first. A case with
`live.hidden_tests` also gets them tested. After the run, the runner clones the
pull request's branch from the fake repository, copies the file or directory
from the case's `hidden_tests/` directory into the clone at the same path, and
runs the `test_command` slot. A failing hidden test fails the case. Only a case
with status `error` makes the exit code non-zero:

```sh
E2E_OPENROUTER_API_KEY=<key> mise run evals -- --suite templates --mode live --case 'ticket-to-pr/live-json-flag' --repeat 3 --max-cost-usd 5
```

The ticket-to-pr live task set is the cases named `ticket-to-pr/live-*`. Each
seeds a small Node repository, and its tests run with `node --test`:

| Case | Task | Correct end |
| -- | -- | -- |
| `live-json-flag` | Add a `--json` flag to a report CLI | Pull request that passes the hidden tests |
| `live-slugify-accents` | Keep accented letters in slugs | Pull request that passes the hidden tests |
| `live-compound-durations` | Parse durations such as `1h30m` | Pull request that passes the hidden tests |
| `live-last-page-bug` | Fix paging that loses rows on the last page | Pull request that passes the hidden tests |
| `live-quoted-csv-fields` | Support quoted CSV fields | Pull request that passes the hidden tests |
| `live-clarification-missing-requirements` | A task that depends on requirements the ticket and repository lack | `needs_clarification`, no push, no pull request |
| `live-clarification-conflict` | A description and acceptance criteria that contradict | `needs_clarification`, no push, no pull request |

Run the set with `--case 'ticket-to-pr/live-*' --repeat 3`. Checks are hard
only: the run's outputs, the recorded writes, and the hidden tests. The
`summary.md` of a run lists each case's passes out of its repeats under
"Passes per case".

The harness reads Conductor worktree ports from `.context/local-services/env`,
starts the API with E2E routes enabled, starts the client with the test VCS
provider enabled, waits for both to become ready, and then runs
`turbo test:e2e`, or `turbo evals` for `mise run evals`.

The harness also starts a credential router at the address the API reads for each
provider fake (GitHub, Slack, Linear, Jira, ClickUp, and Notion), unless the
caller set that address in the environment. A router holds no fixtures. Each spec
runs its own fake on a private port and registers the credentials the API presents
to it, through `listenFake` in `@shipfox/e2e-core`, and the router forwards a request
to the fake that registered its credential. Specs and eval cases that use the same
provider therefore run in parallel. A spec started outside the harness fails with
the router's address in the message.

The harness also runs a local Shipfox Registry on the API port plus 17. It
recreates the `registry_e2e` database and a file store, builds the fixture
packages under `harness/registry/` with the release tool, imports them, and
starts `apps/registry`. It signs with a key generated for the run, and the API
trusts only that key through `REGISTRY_URL` and `REGISTRY_TRUSTED_KEYS`. The
fixtures live in the `fixture` namespace: `fixture/example` is an action,
`fixture/workspace-import` is an action that imports a package it did not
bundle, and `fixture/example-template` is a template that uses
`fixture/example`, with this
[guide](harness/registry/templates/example-template/GUIDE.md). Add a fixture as a
directory under `harness/registry/actions/` or `harness/registry/templates/`.
The directory name is the package name. The seed and server logs are
`shipfox-registry-seed.log` and `shipfox-registry.log` in the diagnostics
directory.

Diagnostics land in `.context/shipfox-e2e-logs/` locally. In CI, a failed browser
and API job uploads the same logs as the `e2e-diagnostics` artifact. A failed flow job
uploads `e2e-diagnostics-flow`. Runner logs from the Flow workflow
are written under `e2e/suites/flow/workflows/.e2e-run/runners/` and attached to
failed scenario results.

For workflow flow details, including `expect.yaml`, `reject.yaml`, scenario
files, and runner logs, use
[`suites/flow/workflows/README.md`](suites/flow/workflows/README.md).

## Review Checklist

For PRs that add or change E2E coverage, check:

- The test is at the lowest level that proves the behavior: `client`, `api`, `flow`, or `eval`.
- Eval cases use `e2e/suites/eval/<surface>`, validate their `case.yaml`, and write local results for every repeat.
- Data setup goes through `/__e2e/<module>` via `@shipfox/e2e-setup-*`; only true external/process boundaries use `drivers/*`.
- Browser specs use screen or kit UI methods instead of raw product locators.
- Specs follow the granularity rule: one test per behavior, one file per surface or journey, present-tense names, and setup outside the spec body.
- Visual snapshots come after assertions, use the package-name `buildName`, and live in behavior specs rather than screenshot-only specs.
- Package dependencies declare the verified surface and use DTO packages instead of server API implementation packages.
- `depcruise` remains green when layer or dependency boundaries change.
