# 010 Future Platform Use Cases

Status: exploratory
Source of truth: docs/formalizing-shipfox-runtime/010-future-platform-use-cases.md

## Purpose

Capture future Shipfox workflow use cases that are outside PR1 scope but useful for evaluating new formalized concepts.

These examples can be shortened later to highlight specific paradigms the runtime formalization should handle explicitly.

This document is non-normative. Its YAML snippets are exploratory product examples, not accepted PR1 syntax. PR1 accepts only the surface described by `001-yaml-surface.md`; future syntax such as `agent`, `gate`, `event_driven`, `parallel`, workflow invocation, deployment, rollback, and agent session persistence requires a dedicated formalization pass before implementation.

## Use Cases

Every YAML block below is exploratory and not accepted PR1 syntax; see `001-yaml-surface.md` for what PR1 accepts and `008-adding-new-concepts.md` for the promotion process.

### Have an agent automatically produce a fix when an error is reported

This is the most basic example. We expect an agent to produce a fix when an error is reported by an error monitoring tool.

#### Expected Behavior

- An error monitoring `error.reported` event is received.
- The workflow starts.
- The code is checked out.
- Some commands are run to set up the environment.
- An agent is spawned. It produces the fix and opens a PR using a dedicated skill.

#### Feature Highlights

- Triggers.
- Native agent integration.
- System executions.
- Default runner environment.

#### Definition

```yaml
# .shipfox/workflows/sentry_error_management.yml
triggers:
  - source: sentry_prod
    event: [error.reported]

jobs:
  fix_error:
    steps:
      - run: npm install
      - agent: debugger
        prompt:
          - '/troubleshoot \n ${{ trigger.event.payload }}'
          - '/pr'

---
# .shipfox/agents/debugger.yml
system_prompt?:
model?:
skills?: [commit, troubleshoot_sentry]
mcp?: [sentry, linear]
tools?: [read_file]
read_only?: false
```

### Constraint an agent to produce code until specific requirements pass

We set up an adversarial process where an agent produces code first, and external checks validate it. These checks can be deterministic executions or other agents.

#### Expected Behavior

- An agent produces code.
- A command is run, such as test execution.
- If the command fails, the loop starts again. The producing agent preserves the original session history, and new context is appended.
- If the command succeeds, an agent is spawned, such as company guidelines verification.
- If the reviewer agent does not validate the produced code, the loop starts again. The producing agent preserves the original session history, and new context is appended.
- If the producing agent validates the code, the cycle ends.

#### Feature Highlights

- Constraint loops.
- Agent session persistence.
- Steps that use other steps' output.

#### Definition

```yaml
jobs:
  make_pr:
    retry:
      max: 3
    steps:
      - run: npm install # 5 minute minimum
      - id: producer
        agent: producer
        prompt: Implement the ticket
        iteration_prompt: Gate failed ${{ retry.failed_step.output }}
        session:
          persistent: true
      - run: npm run test
        gate:
          success_if: exit_code == 0
          on_failure:
            restart_from: producer
            output: "Tests failed ${{ step.stdout }}"
      - agent: reviewer
        prompt: /review
        output_schema:
          review: string
          pass: boolean
        gate:
          success_if: step.output.pass == true
          on_failure:
            restart_from: producer
            output: "Agent rejected the PR ${{ step.output.review }}"
        session:
          persistent: false
```

### Continue a previously finished agent session when an external event occurs

An agent produces code and opens a pull request on GitHub. If someone leaves comments on the pull request, or if the continuous integration pipeline fails, we want to restart the agent.

#### Expected Behavior

- The workflow starts.
- An agent produces code and opens a pull request on GitHub.
- The workflow pauses.
- A user leaves a comment on the pull request.
- The workflow resumes.
- An agent is spawned with the same file-system state and session history as before. New context from the comment is added.
- The workflow pauses.
- The continuous-integration pipeline fails.
- An agent is spawned with the same file-system state and session history as before. New context from the failure is appended.
- The pull request is merged.
- The workflow ends.

#### Feature Highlights

- Event-driven workflow iteration.
- File-system persistence.
- Agent session persistence.

#### Definition

```yaml
triggers:
  - source: linear
    event: ticket.assigned

jobs:
  make_pr:
    steps:
      - run: npm install
      - agent: producer
        id: producer
        prompt: Implement the ticket
      - id: git_branch
        run: git branch --echo
    output:
      branch: steps.git_branch.stdout
      producer_session: steps.producer.session

  iterate_on_pr:
    needs: make_pr
    event_driven:
      triggers:
        - source: github
          event: actions.workflow_run.completed
          filter: workflow.ref == ${{ jobs.make_pr.outputs.branch }} and workflow_run.conclusion == "failure"
        - source: github
          event: issue.comment.created
          filter: issue.branch == ${{ jobs.make_pr.outputs.branch }}
      batching:
        max_events: 100
        debounce: 5m
      concurrency: 1
    steps:
      - agent: producer
        prompt: Feedback received on the PR {{ job.trigger.event.payload }}
        session:
          persistent: true
          fork_from: ${{ jobs.make_pr.outputs.producer_session }}
```

### Run parallel agents on the same task and have a judge pick the best output

To improve precision on a given task, we want to run the task on three agents, each using a different model, and then use a fourth agent to choose the best answer.

We will take the example of an alert that triggered an incident, and for which we want to run a diagnostic on the alert posted to the incident's Slack channel.

#### Expected Behavior

- An `incident.created` event is received.
- The workflow starts.
- We start three different runtime environments in parallel.
- The code is checked out.
- An agent is spawned. It uses the same skill to troubleshoot in each runtime. Each runtime uses a specific model.
- Once all three runtimes have finished, a new runtime is started.
- Code is checked out.
- An agent is spawned and given the output of the three agents that ran in parallel. It uses a custom skill to select the best investigation and posts the result in the incident Slack channel.
- The workflow ends.

#### Feature Highlights

- Parallel executions within a workflow.
- Multiple runtime environments within a workflow.
- Steps that use other steps' output.

#### Definition

```yaml
jobs:
  investigation:
    parallel: [chatgpt_4o, opus_4.6, kimi_2.3]
    steps:
      - agent: investigator
        id: investigator
        model: ${{ parallel.key }}
        output_schema:
          type: object
          properties:
            investigation:
              type: string
              description: The investigation of the issue
    output:
      investigation: steps.investigator.output

  judge:
    needs: investigation
    steps:
      - agent: judge
        prompt: Help investigate the issue and identify the most accurate answer. Here are 3 investigations: ${{ jobs.investigation.*.outputs.investigation }}
```

### Make a release, deploy, and monitor for errors

Every 4 hours, or via a manual trigger, an agent makes a release. It produces the changelog, promotes the changes to production, and listens for errors and alerts. If critical errors or alerts occur, are related to the release, and could be fixed by a rollback, the workflow initiates a rollback.

#### Expected Behavior

- A cron or manual trigger occurs.
- The workflow starts.
- The code is checked out.
- An agent is spawned. It uses a custom skill to review changes since the last release and produce a coherent changelog. It then publishes the changelog to a dedicated Slack channel.
- A command is executed to trigger promotion of the release to production.
- The workflow starts.
- A new error is reported.
- The workflow pauses.
- An `error.reported` event occurs.
- The workflow resumes.
- An agent is spawned. It uses a skill to determine whether the error is related to the release and whether a rollback would help.

### End to end: produce a fix and monitor to ensure resolution

#### Expected Behavior

- A new `error.reported` event occurs.
- The workflow starts.
- The code is checked out.
- An agent is spawned with a diagnostic skill. It produces a fix and opens a pull request on GitHub.
- The workflow pauses.
- We receive a `pull_request.mergeable` event.
- The workflow resumes.
- We run a command to merge the pull request.
- An agent is spawned to determine if the fix is urgent and needs immediate deployment.
- If the fix is urgent, we trigger the deploy workflow.
- The workflow pauses.
- We receive `workflows.deployment.finished`.
- The workflow resumes.
- We check if our fix is in the release. If it is in the release, we continue; otherwise, we wait for another event.
- The workflow pauses.
- On a cron schedule, every 2 minutes.
- The workflow starts.
- We spawn an agent that checks with the error reporting tool whether the error volume went down post-deployment.
- If the error is effectively fixed, the job finishes.
- If the error is still occurring 30 minutes after deployment, an agent is spawned with the original agent's context, and we append the new context. This effectively brings us back to the start of the workflow with the additional context.
- The workflow stops.

#### Feature Highlights

- Full lifecycle workflow.
- Triggering another workflow from within a workflow.
- Forcing structured output to agents.
- Conditional branching.
- Event-driven workflow iteration, with continue condition.

### Agent orchestration without codebase context

#### Expected Behavior

- A cron triggers the workflow.
- The workflow starts.
- We spawn an agent with a skill that allows it to fetch past CI executions. Its goal is to identify new failures since the last run. It also has access to the VCS and attempts to correlate changes with newly identified CI failures. It sends a Slack message with a summary of its findings on a dedicated Slack channel.

#### Feature Highlights

- Agents can access skills and MCPs without checking out the code in their execution context.
