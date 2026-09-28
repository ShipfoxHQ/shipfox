# Route Slack requests to your workflows

Let people mention one Slack app for any request. The dispatcher reads the thread, picks the workflow that handles the request, and starts it with the inputs it needs.

This template connects the starter factory. Questions go to the codebase question workflow, ticket requests to the Slack ticket workflow, and change requests to the task to pull request workflow. Each routed workflow runs on its own and reports in the same thread.

## Prerequisites

- Connect Slack with the Shipfox app, and invite the app to every channel where it routes requests.
- Set up each workflow the dispatcher starts in the same project, and merge it so it syncs. Each needs a `manual` trigger.
  - `ask-codebase`, with the `dispatch_only` entry point.
  - `slack-to-ticket`, with the `dispatch_only` entry point.
  - `ticket-to-pr`. Without a tracker, it starts only from the dispatcher or another manual start.
- The runner has Bash. The dispatcher needs no checkout, build setup, or test command.

Set up the routed workflows first. A dispatcher that lists a workflow that does not exist fails when it routes a request there.

## Scope the workflow

The dispatcher starts only the workflows that its prompt lists. The route agent picks one path from the `workflow` output's `enum`, so it cannot start any other workflow, even when a message asks it to.
The `start` step passes no `project_id`, so every routed workflow must belong to the dispatcher's project. For several repositories, set up one dispatcher per project with separate channels.

The route agent has no tools. It reads the thread that the `thread` job passes in its prompt, and it cannot write anywhere.
Tool steps outside the agent post in the thread and start the routed workflow.

Mentions from other apps and bots are ignored, so another bot cannot start a run.
Replace `replace-with-channel-id` with the IDs of the channels where the app routes requests, such as `["C0ABC12345", "C0DEF67890"]`. The app ignores mentions everywhere else, even in channels it belongs to.

Do not list a channel in this workflow and in a workflow that answers mentions on its own. Both would reply to one mention. The routed workflows use `dispatch_only` for this reason.

## Fill in the workflow list

The route agent's prompt lists each workflow it can start. Each entry names the workflow file, says what it does and where its result appears, and lists its inputs.

Adapt the list to the project:

1. Call `list_workflow_definitions` for the project, and find each routed workflow's configuration path.
2. Replace each path in the prompt with that path. Make the same change in the `workflow` output's `enum`.
3. Replace every `replace-with-owner/repository` with the project's repository, such as `acme/api`. The task to pull request workflow stops when its `repository` input names another repository.
4. Remove the entry of a workflow the project does not use, from the prompt and from the `enum`. Keep the empty string in the `enum`.

Each entry's "Use it" sentence decides the route, so keep it specific. Two entries that describe the same request make the agent ask which one the person means.

### Add a workflow

Any synced workflow with a `manual` trigger in the project can be routed. To add one:

1. Add a numbered entry to the prompt with its path, what it does, when to use it, where its result appears, and each input it reads.
2. Add its path to the `workflow` output's `enum`.
3. Make sure the workflow reports its result. It can reply in the thread from its `channel_id` and `thread_ts` inputs, like the codebase question workflow does.

Describe inputs as the workflow reads them. The agent passes every input as a string, and each input is limited to 4,000 characters.
The `check_thread` step fails the run when the inputs name a `channel_id` or `thread_ts` other than the thread that started it. A routed workflow therefore cannot reply in another channel.

## Choose a model

Confirm the provider, model, harness, and thinking setting for `# model:route`.
The step reads one thread, picks one entry, and writes a task description and acceptance criteria for implementation requests. It does not read code, so it needs less than the routed workflows.

## Outcomes

The route agent chooses one status. Each posts one message in the thread.

| Status | Writes |
| --- | --- |
| `start` | Starts the chosen workflow and posts `Shipfox started` with a link to its run and where its result appears. |
| `needs_information` | Asks at most three questions and starts nothing. The request fits a workflow but lacks an input, or it fits several workflows. |
| `already_started` | Says which earlier run handles the request and starts nothing. |
| `no_match` | Says which kinds of requests it can route and starts nothing. |

After the agent asks questions, answer them in the thread and mention the app again. The new run reads the whole thread.

## What happens after a start

`start_workflow_run` returns as soon as the routed run is created. The dispatcher does not wait for it to succeed, so the start message links the run instead of claiming a result.

The routed workflow reports its result in the thread:

| Routed workflow | Result in the thread |
| --- | --- |
| Codebase question | The routed workflow posts the answer, its questions, or a failure notice. |
| Slack ticket | The routed workflow posts the ticket link, its questions, or a failure notice. |
| Task to pull request | The dispatcher's `follow_up` job posts the pull request link, the agent's questions, or that the run stopped before it opened a pull request. |

The task to pull request workflow does not post in Slack. The `follow_up` job listens for Shipfox events of the routed run:

- The `implement` job's `job.completed` event arrives when the pull request opens. It carries the job's `status`, `questions`, and `pr_url` outputs.
- The routed run's `run.completed` event ends the listener for workflows that report themselves.

The listener handles one batch of events and stops after 12 hours. With the feedback loop on, the task run stays open until the pull request closes, but the dispatcher run ends when the pull request opens.
For another workflow that does not post in Slack, add a matcher for its result job and a step that posts the result.

The listener starts after the `route` job finishes. The dispatcher misses an `implement` job that finishes before that, and posts nothing when the run completes. An implementation job checks out and changes code first, so it rarely finishes that fast.

A routed workflow whose first job fails posts nothing, for example when no runner matches. Open the run from the start message to see why.

## Duplicates and loops

- Slack retries of the same event are recorded once, so they do not start a second run.
- When Shipfox retries the `start` step after a temporary failure, it returns the same routed run. A manual rerun of the step can start another one.
- The route agent looks for the `Shipfox started` message. When the request that started the run was already started and nothing new was asked, it replies with `already_started`.
- Two mentions that start before either run posts its start message can each start a workflow.
- The dispatcher has no `manual` trigger. `start_workflow_run` needs one, so no routed workflow can start the dispatcher again.
- Shipfox limits a chain of started runs to five levels and 100 runs per root run.

## Expected writes and failures

Each run makes at most these writes:

- One started run of a listed workflow in the project.
- One message in the thread: the start message, questions, the earlier run, the list of routes, or a failure notice.
- For the task to pull request workflow, one more message with the pull request link, the questions, or the stopped run.

The routed workflows make their own writes, as their guides describe.
The dispatcher never changes a repository.

A failed `route` job posts a short notice with the run number. It may already have started a workflow, so check the thread and the run before asking again.
The workflow cannot post the notice when the app cannot read or write the channel, for example when the app is not invited.

## Verify the workflow

Before relying on an adapted workflow, run it in an allowed test channel:

- Ask a question about the code, and check that the codebase question workflow answers in the thread.
- Ask for a ticket for a discussed change, and check that the ticket link appears in the thread.
- Ask for a small, clear change with acceptance criteria. Check the start message, then the pull request link from the dispatcher.
- Ask for a change without saying how to check it, and check that the dispatcher asks and starts nothing.
- Mention the app again with the same request, and check that it names the earlier run and starts nothing.
- Ask for something no workflow handles, and check that the reply lists the kinds of requests it routes.
- Mention the app in a channel that is not listed, and check that no run starts.
