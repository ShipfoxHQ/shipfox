# Fix failing dependency-bot CI

Use this template for dependency update pull requests whose GitHub Actions run fails.

## Prerequisites

- The repository uses GitHub Actions for CI.
- Dependabot, Renovate, or another dependency bot opens pull requests in the repository.
- The project source is a GitHub connection that can read Actions logs.
- Push mode also needs write access to repository contents.
- Comment-only mode needs permission to comment on pull requests.

## Choose the options

### Bot identity

The shipped workflow matches `dependabot[bot]`. Keep that login for Dependabot.

For Renovate, replace it with `renovate[bot]`. For a custom bot, use its exact GitHub login. Keep the failure and pull-request checks in the trigger filter.

### Delivery mode

Keep one marked delivery block:

- `push_fix` commits the tested change and pushes it to the bot branch.
- `comment_only` leaves the branch unchanged and posts the agent's proposed fix on the pull request.

For comment-only mode, also remove the marked checkout `permissions` block. This prevents the job from receiving Git write access.

### Model profile

Replace `replace-with-resolved-implementation-model` with the implementation model from the selected profile.

## Fill the command slots

Replace `# slot:setup_commands` with one or more YAML step entries. Keep them before `fix_failure` so the agent can reproduce the CI failure.

For example:

```yaml
      - key: install_dependencies
        run: npm ci
```

Keep the same indentation under `steps:`. A bare command is not a valid step.

Replace `replace-with-test-command` with the command that proves the fix. Use the closest local equivalent of the failed GitHub Actions check.

## Expected writes

The fixing agent edits only the runner checkout. It cannot write to GitHub through integration tools.

Push mode creates one commit on the dependency bot's existing branch. Comment-only mode posts one pull-request comment and does not push repository changes.
