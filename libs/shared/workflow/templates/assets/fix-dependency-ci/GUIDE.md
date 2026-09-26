# Fix failing dependency-bot CI

Diagnose a failed dependency update and deliver a tested repair or an actionable explanation.

## Prerequisites

- The repository uses GitHub Actions and a dependency bot.
- The GitHub connection can read pull requests and Actions logs, and post PR comments.
- Push mode also requires repository write access and compatible commit rules.
- The runner has Bash, Git, and Base64 utilities.
- Bootstrap provides the toolchain and services needed for the selected checks.

## Scope the workflow

Replace `replace-with-owner/repository` with the selected project's exact GitHub repository name.
A connection can receive events from several repositories. Keep this filter even when the project has one source.

The trigger accepts failed initial workflow runs associated with exactly one PR.
It ignores manual reruns, ambiguous PR associations, and CI started by Shipfox's repair push.
The inspection step checks the PR author, open state, source repository, branch, and commit.
Fork PRs and failures from an older commit are skipped before repair starts.

Runs for one repository and PR share a concurrency group.
The active run finishes; only the newest additional run waits.
A queued run checks whether its event still describes the PR head.
This prevents overlapping repairs, but separate failures without a new commit can still produce repeated diagnoses.

## Choose the options

### Bot identity

Keep `dependabot[bot]` for Dependabot, or replace it with `renovate[bot]` for Renovate.
For a custom bot, use its exact GitHub login.
The initial CI actor must match this login. The inspection step also verifies that this actor authored the PR.

### Delivery mode

Keep every marked block for the chosen mode and remove the others.

- `push_fix` commits the staged repair, pushes to the bot branch, and posts the result.
- `comment_only` posts an applicable patch after local checks pass. It leaves the branch unchanged.

For comment-only mode, remove the marked checkout `permissions` block too. The checkout then receives read access.
Both modes post diagnoses when a person must act or no repair is needed.
The delivery step skips repair results for stale or closed PRs. Failure notices describe a specific run and can arrive later.

Push mode can interact with existing auto-merge rules. Those rules might merge the agent's repair without another human review.
Dependabot normally stops automatic rebasing after another author adds commits.
Bot recreation or later updates can discard the repair.

The commit title follows repository conventions through the agent prompt.
The shell commit is not signed by this template. Check signing and sign-off requirements before choosing push mode.

## Choose a model

Confirm the provider, model, harness, and thinking setting for `# model:fix`.
Retries continue the `dependency_repair` session. Keep that binding consistent.
The manifest has no tested model reference or scored suggestion.

## Fill the command slots

Replace `# slot:setup_commands` with YAML steps that bootstrap the toolchain and services.
Keep dependency installation out of bootstrap: installation failure must reach the repair agent.
Bootstrap must leave HEAD and repository files unchanged, including unignored untracked files.

Replace both `replace-with-install-command` occurrences with the same dependency installation command, such as `npm ci`.
Replace both `replace-with-test-command` occurrences with the same relevant validation command.
Keep the surrounding subshells, logging pipeline, and exit-code handling.
The initial reproduction records failure without stopping the agent. Validation repeats installation after every repair attempt.

Use checks that reproduce the selected GitHub workflow, including its working directory and required services.
For repositories with unrelated CI workflows, narrow the trigger by workflow name and choose matching checks.
A generic unit-test command does not prove that a failed build or type check was repaired.

Installation and validation output goes to `.git/shipfox-test.log`.
The agent reads that file on retries and stages only intended repair files.
Delivery checks reject unstaged changes, unignored untracked files, changed commit history, and GitHub workflow edits.

## Outcomes and patch delivery

The agent preserves the intended dependency upgrade. It cannot solve a failure by reverting the upgrade or weakening checks.

| Outcome | Result |
| --- | --- |
| Repair candidate | Installation and validation must pass before delivery. |
| No change needed | Local checks pass without edits. The report does not claim GitHub CI passed. |
| Needs human help | The report explains missing configuration, an unsupported check, or a migration decision. No changes are delivered. |
| Superseded | Delivery finds a closed PR or a changed head. It skips the repair result. |
| Patch too large | The report explains the delivery limit. Use push mode or repair the PR manually. |

Comment-only patches include new files and binary changes.
The comment contains Base64-encoded patch data for an exact source commit.
Save the Base64 text as `$HOME/shipfox-repair.base64`, outside the repository.
From the repository checkout, check out the source commit shown in the comment.
Decode and inspect the patch before applying it:

```sh
base64 --decode "$HOME/shipfox-repair.base64" > "$HOME/shipfox-repair.patch"
# On macOS, use base64 -D instead of base64 --decode.
git apply --check "$HOME/shipfox-repair.patch"
git apply --index "$HOME/shipfox-repair.patch"
```

The patch limit is 30,000 bytes before encoding. Oversized patches are never truncated or reported as delivered.

The workflow checks the live PR and remote branch again before delivery.
Pushes never force-update the branch. A concurrent update can still reject a push after the check.
A later CI failure needs a separate investigation; this template does not listen for follow-up results or rerun GitHub Actions.

## Expected writes and failures

Push mode creates one commit on the bot branch. Both modes can post one result or failure comment.
The report runs separately, so a failed comment does not undo a completed push.
Failure notices do not recheck PR eligibility. They report a past run, even if the PR has since changed or closed.
Inspect existing commits and comments before rerunning a failed workflow.
A runner or integration failure can also prevent the failure comment from being posted.

The agent has only read integration tools. Push mode's persisted Git credential remains accessible to shell commands and dependency scripts.
The prompts do not isolate that credential. The GitHub provider also requests workflow write permission for writable checkouts.
The delivery check rejects staged GitHub workflow changes, but it cannot restrict arbitrary commands that use the credential.

The reported checks are local. A successful push does not prove that GitHub CI passed.
Before relying on an adapted workflow, validate every selected option and run it against a real dependency PR.
Exercise installation failure, incompatible APIs, stale events, no-change diagnoses, and comment-only patch application.
