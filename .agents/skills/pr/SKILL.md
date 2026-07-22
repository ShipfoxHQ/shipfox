---
name: pr
description: "ALWAYS use this skill when creating pull requests. Applies Shipfox agent sequencing for GitHub CLI review preparation and pull-request creation. Trigger on create PR, open PR, submit PR, make PR, push and create PR, or prepare changes for review."
allowed-tools: Bash
---

# Create Pull Request

Create a pull request after applying the shared contributor rules and the
agent workflow below.

Before opening a pull request, read the
[contributor review standard](../../../CONTRIBUTING.md#prepare-a-change-for-review).
It owns shared pull-request scope, title, description, and Linear-reference
rules for humans and agents.

When the change may affect a published package, read the
[Changesets and publishing workflow](../../../docs/guides/local-development-and-release-workflow.md#publish-packages-with-changesets).
It owns when a Changeset is required and how releases are published.

## Process

1. Check `git status --porcelain`. If intended changes are uncommitted, use the
   repository commit workflow. Ask before committing only when the intended
   scope is unclear.
2. Inspect `git status`, `git log origin/main..HEAD --oneline`, and
   `git diff origin/main...HEAD`. Confirm the branch is not `main` and contains
   only the intended review scope.
3. Apply the shared Changeset rule. If one is required and absent, invoke the
   `generate-changeset` skill or use `pnpm exec changeset` interactively, then
   commit it before opening the pull request.
4. Use the contributor standard to prepare the title, description, and Linear
   reference. If it is unclear whether the change fully resolves an issue, ask
   before choosing a closing keyword.
5. Push the branch when needed with `git push -u origin HEAD`, then create the
   pull request:

```bash
gh pr create --base main --title "<title>" --body "$(cat <<'EOF'
<description body here>
EOF
)"
```

Pass `--draft` when the user request, task context, or arguments require it.

## Edit an existing pull request

Use `gh api` to update an existing pull request:

```bash
gh api -X PATCH repos/{owner}/{repo}/pulls/PR_NUMBER \
  -f title='New title' \
  -f body='New description'
```

Report the pull-request URL, branch, included commits, validation status, and
any follow-up work.
