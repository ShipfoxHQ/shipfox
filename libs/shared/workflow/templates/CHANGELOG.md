# @shipfox/workflow-templates

## 2.0.0

### Major Changes

- 9806da2: `TemplateLoader` is asynchronous and version-aware.

  - **Interface:** `list`, `get({package, version?})`, `versions({package})`, and `compose({package, version?, bindings, options?})` return promises. `get` and `compose` take the latest version when `version` is omitted, and `compose` applies `options` to the YAML.
  - **Templates:** `WorkflowTemplate` and `WorkflowTemplateAsset` carry a `version`, and `WorkflowTemplate` a `package` name (`shipfox/<id>`). A bare id still names the first-party package, through `resolveTemplatePackage`.
  - **Directory loader:** `createDirectoryTemplateLoader(path)`, exported from `@shipfox/workflow-templates/testing`, serves a catalog directory.
  - **Removed:** `listShippedTemplates` and `getShippedTemplate`. `loadShippedTemplates` stays as the synchronous read of the embedded templates.

- 3e8ff99: Manifest v2 makes slots, secrets, and variables described objects; replaces `start_label` with required `starts`; and adds `keywords`, `flow`, `writes`, `prerequisites`, and `related`. It removes manifest `id`, `revision`, `added_at`, and `rank`; the loader supplies identity and compatibility metadata beside the manifest.
- 70e6983: Replaces `suggested_models` in the `get_workflow_template` result with bounded `model_recommendations`, so the response fits the size limit for any workspace catalog.

  Placeholders are grouped by the binding their tested model resolves to. Each group has a mode: `recommended` (the tested model and up to four labelled alternatives), `template_default` (the tested model without scores), `workspace_default` (the tested model is unavailable), or `choose`. Every choice carries its complete binding and `provider_required`.

  `@shipfox/workflow-templates` removes `suggestModels` and the manifest `models.<placeholder>.reference` field; the `# model:` line now records the tested setting. The `create-workflow-from-template` skill confirms models per group through a new `choose-models.md` reference.

### Minor Changes

- b97171d: Adds Discord as a `chat` provider of the `ask-codebase` template. A mention of the bot in an allowed channel, or in a thread of one, starts the run. The workflow reads the thread and replies in the thread of the mention, which Discord creates when the message has none.

  The title and summary are now provider-neutral, and the workflow names its posted reply `message_id` internally while still publishing `reply_ts`. The guide covers the Discord channel IDs, manual inputs, and message limits.

- 5f88947: Adds the `ask-codebase` template. It answers repository questions in the Slack thread where someone mentions the app, or when a dispatcher starts it with `channel_id`, `thread_ts`, and an optional `request`.

  The workflow reads the thread with a tool step and answers from a read-only checkout without saved credentials. Its agent has no integration tools. It posts one reply with file references and the source commit, or a failure notice. The guide covers channel scope, the manual-only option for dispatchers, outcomes, and expected writes.

- ba0d750: Updates the dependency CI repair template to revision 2.

  Scopes runs to one repository and bot-authored PR, serializes repairs, and skips stale failures. Installation errors now reach the repair agent, and validation repeats installation after edits.

  Adds explicit no-change and human-help outcomes, tested patches for comment-only delivery, and result or failure comments. Pushes check the current PR head and preserve the intended upgrade. The guide explains credential access, auto-merge, commit rules, and local validation limits.

- e1cfc2a: Defaults PR feedback and Linear updates, uses GPT 6 Luna max and GLM 5.3 Flash, and guides trigger-safe issue selection, status retries, and dev-run links.
- 3b3e25c: Definitions record the registry packages they use and report newer versions.

  - **Refs:** Definitions report the registry actions and templates they use. A template with a pre-registry header gets no update notice.
  - **Notices:** `GET /workspaces/:workspaceId/definitions/:definitionId/package-updates` returns, per reference, the latest version, whether it is behind, the highest bump over the skipped versions, whether an action widens its capabilities, the newest changelog entries, and the upgrade prompt for a template. It is separate from the definition read, so definition pages never wait on the registry.
  - **Prompt:** `buildUpgradePrompt` from `@shipfox/workflow-templates/prompt` writes the prompt a user pastes into a coding agent to upgrade a template.

- 8b16e92: Adds Discord as a report provider for the default-branch CI repair template. The optional report role can now post failures that need a person, repair pull request links, or both in a Discord channel.
- 184305a: Adds the `fix-default-branch-ci` template. It investigates the first failed push or scheduled GitHub Actions run on the default branch after the workflow last passed. It skips failures while a repair pull request for the same workflow is open.

  The agent works in a read-only checkout without saved credentials. It classifies the cause as a regression, flaky test, setup issue, external outage, or unknown. For an actionable cause, it opens a draft repair pull request after the configured checks pass. Repairs over the 30,000-byte delivery limit open no pull request. A separate job pushes the tested patch. External outages produce no writes. The optional `report` role notifies a Slack channel about failures that need a person, repair pull requests, or both.

- 48b8237: Adds GitHub issues as a tracker for the `ticket-to-pr` template. A label or an assignee on an open issue in the project's repository starts the workflow. By default, the workflow adds an in-progress label when work starts and comments on the issue with the PR link. The PR body ends with `Fixes #<number>`, so GitHub links the PR to the issue.

  `get_workflow_template` now suggests the project's source integration connection for a role on the source provider, such as GitHub issues as the tracker.

- f5bdc5b: Exports `FIRST_WORKFLOW_PROMPT` from the browser-safe `@shipfox/workflow-templates/prompt` subpath for consumers that need the first-workflow onboarding prompt.
- e3b9558: Templates can declare optional roles. A role with `optional: true` gives a `question` and a `tradeoff`. When the role is unbound, `composeTemplate` drops its parts. `composeTemplate` now writes the `# shipfox-template:` header from the bound roles, so base workflows must no longer declare it. `templateRoleBindings` lists every supported binding, with each optional role both bound and unbound.

  `list_workflow_templates` returns `optional`, `question`, and `tradeoff` for each role. It computes `compatible` and `missing_providers` from required roles only. `get_workflow_template` accepts optional roles being left out. The create-workflow-from-template skill asks about an optional role only when the workspace has a connection for it.

- 5ce9d5b: Updates the `fix-dependency-ci` template to revision 3 and renames it to "Repair failing pull request CI".

  A new `pr_selection` option keeps dependency-bot pull requests as the default and adds pull requests with a chosen label or all same-repository pull requests. Pushed repair commits carry a `Shipfox-CI-Repair:` trailer. The trigger ignores failures on those commits whichever account pushed them, so a repair that still fails never starts another.

- 5fb1fbd: Adds Discord as a second notify provider for the `report-failed-runs` template. The report posts to a Discord channel, and the agent's diagnosis replies in a thread on that message. A long diagnosis is split into several messages, and one over 9,000 characters is cut.
- b1cc902: Adds the `report-failed-runs` template. Each matching failed, synced Shipfox workflow run starts a report from its `run.completed` event and posts one Slack message with the failed jobs and steps, the step error, a log excerpt, and a next step. An agent then replies in the report's thread with a diagnosis of the cause. Options scope reports to the project or the workspace and filter workflow files.
- 15282f5: Adds a Discord part to the `slack-dispatcher` template, so its `chat` role accepts `slack` or `discord`. A mention of the Shipfox bot in a listed Discord channel, or in a thread of one, starts the dispatcher. The routed workflows receive the `channel_id` and `message_id` of the mention, and every reply goes into the thread under it. The title is now "Route chat requests to your workflows", and the summary no longer names Slack. The template id is unchanged.
- 3c92a34: Adds the `slack-dispatcher` template. When someone mentions the Slack app in a listed channel, an agent reads the thread and picks one workflow from a list in its prompt. Each entry describes what the workflow does and its inputs. The workflow then starts the chosen workflow with `start_workflow_run` and links the run in the thread. The starter list routes to the `ask-codebase`, `slack-to-ticket`, and `ticket-to-pr` templates.

  An output `enum` limits the agent to the listed workflows in the dispatcher's project. A check rejects inputs that name another Slack thread. The agent asks when the request is unclear or an input is missing, and points to the earlier run for a repeated request. When the task to pull request workflow opens its pull request, a listening job posts the link or the agent's questions. The dispatcher has no manual trigger, so no routed workflow can start it again.

- 257e53e: Adds Discord as a chat provider of the `slack-to-ticket` template, now titled "Create a ticket from a chat conversation". A mention of the Shipfox bot in a listed channel or thread starts it, the agent reads the conversation with the Discord `read_thread` tool, and the workflow replies with the ticket link in the thread under the mention, starting one when there is none. A manual start takes `channel_id` and `message_id`, and the `ticket` job publishes the link message's ID as `reply_id`. The Slack variant keeps its behavior. Its ticket text and Linear link now say "chat conversation" instead of "Slack thread".
- e701cfc: Adds the `slack-to-ticket` template. It drafts one Linear ticket from a Slack thread and the project's repository, then links the ticket in the thread. It starts from a mention in listed channels, or from a dispatcher with `channel_id`, `thread_ts`, and an optional `request`.

  The agent reads the thread with the Slack `read_thread` tool and drafts from a read-only checkout without saved credentials. The ticket has problem, scope, acceptance criteria, relevant code, evidence, and open questions sections, with links to the thread and the checked-out commit. When an essential fact is missing, the workflow asks in the thread instead. A thread that already has the workflow's ticket link gets a reply that names the existing ticket, and no new ticket. Options add tickets to a Linear project and keep only the manual entry point.

- da36a04: The ticket to pull request template is now "Task to pull request", at revision 4. A Slack dispatcher, a ticket loader, or a person can start it manually with `repository`, `title`, `description`, and `acceptance_criteria` inputs, plus optional `url`, `request`, `ticket_id`, and `identifier`.

  - **Optional tracker:** the `tracker` role is opt-in, so a workspace with only GitHub can use the template. Without a tracker, only manual starts run it.
  - **Manual starts:** a start with a missing required input, or a `repository` other than the project's, fails before the agent runs.
  - **Outcome:** a successful run publishes `status`, `identifier`, `questions`, `pr_number`, `pr_url`, and `branch` as workflow outputs.
  - **Unclear tasks:** the agent asks for clarification when the acceptance criteria are missing or cannot be checked, or when the task needs another repository.
  - **Pull requests:** the PR body ends with `Fixes <identifier>` for a ticket, or links the task's source.
  - **Tracker parts:** they now set ticket fields on a shared `task` step and own their write-back jobs. The package README documents the new part contract.
  - **Summaries:** every shipped template now has a shorter summary that leads with the outcome.

- fe15ea2: Adds version rules and derived metadata for templates. `computeTemplateBump` returns the minimum bump between two template manifests. `deriveTemplateMetadata` returns the integrations, interface, choices, and size of a template version, and `workflowTemplateMetadataSchema` validates it.
- f9c2dec: Shipped templates now carry catalog metadata: keywords, flow, writes, prerequisites, and related templates. Manifest `writes` and `prerequisites` no longer take `when` conditions: a write is `{provider?, action}`, and a prerequisite is a string.
- 4a664ca: Adds composition formats. `composeTemplate` and `applyTemplateOptions` take a `composition` number, defaulting to the current format. The package exports `SUPPORTED_COMPOSITIONS`, `CURRENT_COMPOSITION`, and `UnsupportedCompositionError`; an unsupported format throws.
- e663112: Adds the registry form of the `# shipfox-template:` header, `# shipfox-template: <namespace>/<name>@<version>; roles: <role>=<provider> ...; options: <option>=<choice> ...`. `parseTemplateHeader` reads both the registry and legacy forms without the manifest, from the header line or a whole workflow. It is also exported from the browser-safe `@shipfox/workflow-templates/header` subpath, with `formatTemplateHeader`. `composeTemplate` takes a third argument with `options` and a `header` choice, `{kind: 'legacy'}` (the default) or `{kind: 'registry', reference}`. `applyTemplateOptions` keeps the blocks of each chosen `# option:X=Y`, deletes that option's other blocks, and removes their marker lines. An option with no chosen value is left unchanged. Composed output is unchanged unless a caller asks for the registry header.
- 15e9d33: `get_workflow_template` accepts `options`, such as `{"pr_mode": "ready"}`, and returns `workflow_yaml` with only the chosen option blocks. The header keeps the legacy form. A call with an unknown option or choice explains the valid ones. The result also carries the manifest's `writes` and `prerequisites` as authored.

  The create-workflow-from-template skill (revision 14) passes the answers as `options` and takes the applicable writes and prerequisites from the result. The template guides no longer repeat their prerequisites and expected writes.

- f187551: Adds `rank` and `start_label` to template manifests. Each loaded template now reports `startsManually`, and the loader rejects a template without a manual trigger when it has no `start_label`. Adds `buildTemplatePrompt`, also exported from the browser-safe `@shipfox/workflow-templates/prompt` subpath. Each of its `choices` is a full clause, such as `with Slack as the report` or `without the tracker part`.
- d0fcdae: Add `templateVariants` for composing the static option and binding variants of shipped workflow templates.
- 8f54fc9: Adds ClickUp as a tracker for the task to pull request template. A tag or status change on a task in one List starts the run. The run can move the task to an in-progress status and comment with the pull request link.
- a4c05ba: The task to PR template accepts Jira as its tracker. A Jira label or a move to a Jira status starts the workflow. The run can move the issue to an in-progress status when work starts, and it comments with the PR link or its questions.

### Patch Changes

- 5a14986: The create-workflow-from-template skill (revision 13) asks each setup question once. It reuses the user's answers in later steps, and a risky test event no longer makes it ask again about ticket updates.
- 5588247: Replaces the `models` list in the `get_workflow_authoring_context` result with `model_count`. The `write-a-workflow` skill now finds models through `list_workspace_models` and writes the chosen `provider`.
- e64c10d: Template setup questions now lead with what each choice means for the user: one line per choice with the default marked, and one short question for values such as a Slack channel ID. The failed run report template's questions and choices are rewritten in plain terms.
- 175482e: Guided template setup now accepts a template named in the prompt, such as one copied from the docs. The agent skips the recommendation, checks the required connections, and asks the user to confirm the named template and its choices before it continues.
- cc644b8: `list_workflow_templates` now marks each role with `from_project`. `get_workflow_template` accepts a project role that matches the project's source provider, and its errors now carry a `message` that names the unknown input, missing role, or invalid provider ID. The tool description and the create-workflow-from-template skill show the expected call shape.
- eab1dd7: The Task to pull request guide now covers two more steps. The agent proposes a first task when the user has none, and explains how to start the next task after setup. The create-workflow-from-template skill (revision 12) ends with a message that links both pull requests. It says that only the workflow pull request installs the workflow.
- fdca5b6: Guided template setup asks fewer, plainer questions. The agent chooses install, build, and test commands from the repository instead of asking the user to confirm them, and asks only when several CI workflows could be watched. Option markers can list several choices, such as `# option:report_outcomes=needs_person,both begin`.

  The agent binds the template's tested model or the workspace default without asking and tells the user they can change it later in the workflow file. The `get_workflow_template` tool description also tells the agent to offer alternatives only when the user asks.

- 9674325: The codebase question and Slack ticket templates ask how people start them in plain terms, and ask for Slack channels only when the app answers mentions. Guided setup no longer suggests values found in repository files, such as a channel from a test configuration.
- a26baf5: The validate-workflow-change (revision 4) and test-workflow-change (revision 3) skills explain that prompt files are read from the dev run's `ref`. To check or test an edited prompt file, the agent pushes the branch and passes it as `ref`.
- 55152c5: Starts workflow dev runs without asking unless the run can make a write that cannot be undone, and picks the most recent matching replay event instead of asking the user to choose.
- 42829e8: Rejects a step `if` that reads `execution.failed` unless the step sets `run_after: always`, and exports `referencesExecutionFailed` from `@shipfox/expression`. The shipped templates now use `run_after` for their failure handlers and drop the `!execution.failed` and `needs.all(n, n.status == "succeeded")` guards it makes redundant.
- d273097: The `write-a-workflow` skill now tells agents to set `path` on every checkout that doesn't own the job root.
- 9674325: Guided template setup no longer looks for install, build, or test commands when the template has no command slots, so the agent does not ask the user about setup it does not need.
- 71c11b1: Fixes the `slack-dispatcher` template failing its run when the workflow it starts replies in the thread itself. The follow-up job filled its pull request and question messages even when no pull request event had arrived, and the missing event failed the whole execution. Each message now renders empty when its event is missing.
- 8786552: Fixes shipped templates so the server accepts their workflow definitions. `ticket-to-pr` lets the reply step post and resolve review threads, and reads GitHub issue labels and Jira descriptions in forms the server accepts. `fix-dependency-ci` and `fix-default-branch-ci` now evaluate their event conditions correctly.
- c29a8bb: Templates use `export`, output `default` and `from_stdout` instead of copying step outputs into job outputs by hand. `fix-default-branch-ci` defaults the `package` outputs and reads its patch with `from_file`. Templates no longer wrap lists in `toJson` where the value is only stringified.
- c14f398: Fixes the Jira variant of `ticket-to-pr` so it moves a ticket to in progress instead of failing before the agent starts.
- b0b0a82: Stops `ticket-to-pr` from pushing a branch, opening a pull request, pushing feedback, or marking a ticket in progress after an earlier step has failed.
- 2ab4025: Workflows can link to their runs. `run.url` in the run context, `event.run.url` on Shipfox run and job events, and `url` on the `start_workflow_run` output hold the run permalink, built from `CLIENT_BASE_URL`. Replaying a Shipfox event stored without `run.url` fills it in. The `slack-dispatcher` and `report-failed-runs` templates use these links instead of `https://app.shipfox.io/runs/`.
- 9549da3: The `write-a-workflow` skill prefers `export`, output `default`, `from_stdout` and `from_file`, and `$SHIPFOX_ENV` and `$SHIPFOX_PATH` over shell plumbing. It no longer needs `toJson()` to pass a list or a map through `env`.
- Updated dependencies [6b4ae32]
- Updated dependencies [d273097]
- Updated dependencies [e087b95]
- Updated dependencies [cfd75e4]
- Updated dependencies [f1f520f]
- Updated dependencies [ab66d1e]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [cb411b1]
- Updated dependencies [a509c87]
- Updated dependencies [150d735]
- Updated dependencies [c8857f4]
- Updated dependencies [76fbfe9]
- Updated dependencies [7517867]
- Updated dependencies [9906470]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [e71cded]
  - @shipfox/workflow-document@3.11.0
  - @shipfox/registry-format@0.1.0

## 1.3.0

### Minor Changes

- 1a724f0: Adds tested model anchor extraction and rejects invalid model markers in composed templates.
- 5ef5488: Add scored model recommendations with intelligence and cost tradeoff labels.
- 5082d8a: The ticket to pull request template is now at revision 3.
  - **Opening pull requests:** the push step no longer fails on runner checkouts.
  - **Before the agent runs:** setup now runs before the agent, and the run stops when another run already has a branch for the issue.
  - **Team scoping:** triggers match one Linear team, and label triggers match the label's name.
  - **Unclear issues:** the agent can ask clarifying questions instead of opening a pull request.
  - **Pull requests and Linear:** PR titles and summaries describe the change; the PR body ends with `Fixes <identifier>`. Linear write-back runs in its own job.
  - **Feedback loop:**
    - It is off by default.
    - When turned on, one listening job handles batched review comments and failed GitHub Actions runs in the implementation session.
    - The agent reads full threads and decides per comment, with an `ignore` outcome.
    - It checks the PR head before pushing.
    - It marks its replies so it never answers itself.
    - The new `resolve_threads` option resolves handled threads.

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
