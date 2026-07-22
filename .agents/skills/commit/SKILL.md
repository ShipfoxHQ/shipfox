---
name: commit
description: "ALWAYS use this skill when committing changes. Applies Shipfox agent sequencing for branch checks, scoped validation, and commit creation. Trigger on commit, commit changes, save changes, make a commit, or create commit."
allowed-tools: Bash
---

# Commit Changes

Create a commit after applying the shared contributor rules and the agent
workflow below.

Before committing, read the
[contributor review standard](../../../CONTRIBUTING.md#prepare-a-change-for-review).
It owns the shared branch-safety and commit-message rules that humans and
agents follow.

When choosing validation, read the
[local development and release workflow](../../../docs/guides/local-development-and-release-workflow.md).
It owns task selection and the validation scope for the changed package.

## Process

1. Inspect `git branch --show-current`, `git status`, `git diff`, and
   `git diff --cached`.
2. Apply the contributor branch rule. If a new feature branch is needed, infer
   a short kebab-case name from the change and issue context.
3. Stage only the intended files when nothing is staged. Preserve an existing
   deliberate staging set.
4. Run the validation selected by the shared workflow. Use the repository's
   agent execution instructions for pinned tooling and package filters. Stop
   and report failures before committing.
5. Write the commit message using the contributor standard. Infer it from the
   diff when the user has not provided one.
6. Create the commit. Use a heredoc when the message needs a body or footer:

```bash
git commit -m "$(cat <<'EOF'
Subject line here

Optional body explaining why.

Refs ENG-123
EOF
)"
```

Report the commit hash, subject, files included, and validation results.
