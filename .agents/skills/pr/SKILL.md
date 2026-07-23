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
   reference. Inspect the source issue and compare its requested scope with the
   branch diff before choosing the keyword:
   - Use `Closes ENG-123` when the task implements that issue and no requested
     work remains. This is the default when the branch covers the full scope.
   - Use `Refs ENG-123`, `Part of ENG-123`, or `Related to ENG-123` only when the
     issue is an umbrella item, the pull request is an explicit partial step, or
     a named requirement remains for another pull request. State the remaining
     work in the description.
   - Optional follow-up improvements do not make the work partial. Neither do a
     draft pull request, a narrow implementation, or a `Refs` commit footer.
   Ask only when the issue and diff contain conflicting evidence that cannot be
   resolved by inspection.
5. Push the branch when needed with `git push -u origin HEAD`, then create the
   pull request:

```bash
gh pr create --base main --title "<title>" --body "$(cat <<'EOF'
<description body here>
EOF
)"
```

Pass `--draft` when the user request, task context, or arguments require it.

Before submission, inspect the final body. A pull request that completes a
Linear issue must contain a closing line such as `Closes ENG-123`. This lets the
Linear integration apply its merge automation.

## Edit an existing pull request

Use `gh api` to update an existing pull request:

```bash
gh api -X PATCH repos/{owner}/{repo}/pulls/PR_NUMBER \
  -f title='New title' \
  -f body='New description'
```

Report the pull-request URL, branch, included commits, validation status, and
any follow-up work.
