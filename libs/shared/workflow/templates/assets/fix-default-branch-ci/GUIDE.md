# Investigate and repair default-branch CI failures

Turn a failed GitHub Actions run on the default branch into a tested repair pull request, or a diagnosis when a person must act.

## Prerequisites

- The repository runs GitHub Actions on pushes or schedules to its default branch.
- The project's GitHub connection can read pull requests and Actions logs, push branches, and open pull requests.
- The runner has Bash, Git, and Base64 utilities.
- Setup provides the toolchain and services that the watched workflow's checks need.
- Slack reporting needs the Shipfox app in the chosen channel.

## Scope the workflow

Replace `replace-with-owner/repository` with the selected project's exact GitHub repository name.
A connection can receive events from several repositories. Keep this filter even when the project has one source.

Replace `replace-with-workflow-path` with the workflow files to investigate, such as `[".github/workflows/ci.yml"]`.
Choose workflows whose checks the runner can reproduce. Leave out deployment and release workflows.

The trigger accepts a failed first attempt of a push or scheduled run on the default branch.
It ignores manual reruns, pull request runs, and runs from other repositories.
Repair pull requests run CI on their own branch, so they never start this workflow.

## Duplicate work and limits

Runs for one repository and GitHub workflow share a concurrency group.
The active run finishes; only the newest additional run waits.

Before investigating, the workflow skips a failure in two cases:

- An open repair pull request for the same GitHub workflow already exists. Repair branches are named `shipfox/default-branch-ci/<workflow ID>-<run ID>`. The check reads the 100 most recently created open pull requests into the default branch.
- The previous completed default-branch run of the same workflow also failed. Only the first failure after a success is investigated. The check reads the 100 most recent runs of the workflow.

A second, unrelated failure during a failure streak is therefore not investigated until the workflow passes again.
If an investigation fails or needs a person, later failures in the same streak are skipped too.

The agent reads at most one page of recent runs, and repeats an intermittent test at most 20 times or 15 minutes.
The validation gate restarts the agent after a failed check, up to the default of five attempts.

## Outcomes

The agent classifies the cause as `deterministic_regression`, `flaky_test`, `setup_issue`, `external_outage`, or `unknown`, then chooses one status:

| Status | Result |
| --- | --- |
| `repair_candidate` | The configured checks must pass. The workflow opens a repair pull request. |
| `needs_human` | The cause is in the repository, but it needs a decision, a settings change, or more evidence. No pull request opens. |
| `not_actionable` | An external outage, an interrupted run, or a failure already fixed on the default branch. The workflow writes nothing. |

For an intermittent failure, the agent reports repeat counts before and after the repair, or a causal explanation grounded in code and logs. One passing run is never treated as proof.

The agent never raises timeouts, adds retries, skips or deletes tests, weakens assertions, or disables checks.
It edits GitHub workflow files only when their configuration causes the failure. Those edits appear in the pull request for review.

The `investigate` job publishes `status`, `classification`, and `summary`. The `deliver` job publishes `pr_number` and `pr_url`.

## Choose the options

### Pull request mode

Keep `draft: true` for the `draft` choice, or set it to `false` for `ready`.
A ready pull request can notify reviewers right away.

### Slack report

The `report` role is optional. Without it, the workflow has no `report` job and needs no Slack connection.

With Slack, replace every `replace-with-channel-id` with the ID of the channel that receives reports, such as `C0ABC12345`.
Use a channel ID, not a name.

For `report_outcomes`, keep the marked block for the chosen choice and remove the others:

- `pull_requests` posts one message when a repair pull request opens.
- `pull_requests_and_diagnoses` also posts the diagnosis when the status is `needs_human` or the repair patch is too large to deliver.

External outages, skipped failures, and other `not_actionable` outcomes are never posted.

## Choose a model

Confirm the provider, model, harness, and thinking setting for `# model:investigate`.
Retries continue the `default_branch_repair` session. Keep that binding consistent.
The step reads logs, compares history, and reproduces failures, so the template suggests a strong model with high thinking. The manifest has no tested model reference or scored suggestion.

## Fill the command slots

Replace `# slot:setup_commands` with YAML steps that install the toolchain, dependencies, and services that the watched workflow needs.
Setup must leave HEAD and repository files unchanged, including unignored untracked files.

Replace `replace-with-test-command` with the checks that the watched workflow runs, from its working directory.
Keep the surrounding braces and logging pipeline.
A generic unit-test command does not prove that a failed build, lint, or type check was repaired.

The agent chooses narrower commands to reproduce the failure. After a repair, the configured command must pass before delivery.
Output goes to `.git/shipfox-test.log`, which the agent reads on retries.

## Expected writes

The investigation uses a read-only checkout of the default branch without saved Git credentials.
The agent has only read integration tools, so it cannot push, comment, or rerun GitHub Actions.

A repair creates one branch and one pull request into the default branch.
A separate job checks out the investigated commit with write access, applies the tested patch, commits it, and pushes the branch. No repository code runs in that job.
The shell commit is not signed by this template. Check signing and sign-off requirements before enabling the workflow.
With Slack, each reported outcome posts one message.

Delivery rejects changed commit history, unstaged changes, unignored untracked files, and empty repairs.
Patches larger than 30,000 bytes are not delivered and are reported as a diagnosis.

A failed run can leave a pushed branch without a pull request. Delete that branch before starting the run again.
The workflow posts nothing about its own failures. Use Shipfox run notifications for those.

## Verify the workflow

Before relying on an adapted workflow, replay real failures from the watched workflow:

- A deterministic failure, such as a broken test on the default branch, and check the pull request and its evidence.
- An intermittent test, and check the repeat counts or causal explanation.
- An external outage, such as a registry timeout, and check that nothing is written.
- A second failure while a repair pull request is open, and a failure right after another failure, and check that both are skipped.
