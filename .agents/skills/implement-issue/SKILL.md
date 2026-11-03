---
name: implement-issue
description: Implement a Linear issue when given a Linear issue ID or URL. Use when the user invokes /implement-issue or asks to implement, build, or complete a specific Linear issue from an issue key, issue ID, or Linear URL.
---

# Implement an issue

## Required input

Require the user to provide a Linear issue ID, issue key, or Linear issue URL before doing anything else. If the user did not provide one, ask for it and stop until they answer.

## Context gathering

Before starting implementation, gather the full Linear context for the requested issue:

1. Fetch the issue itself.
2. Fetch all associated issues, including parent, child, related, blocked-by, blocking, duplicate, and any other linked Linear relationships available through the Linear tools.
3. Fetch the project the issue belongs to, if any.
4. Fetch all other issues in that project.
5. Fetch every document linked from any fetched issue or project.
6. Continue following newly discovered linked issues, projects, and documents until the useful context graph has been covered or there is a clear cycle/repetition.

Treat Linear as the source of truth for product intent, requirements, acceptance criteria, state, priority, ownership, and project context.

## GitHub pull request context

If any fetched Linear issue links to GitHub pull requests, fetch each pull request before implementation:

1. Read the pull request title, description, author, branch, review state, checks, and merge status.
2. Fetch the diff for each pull request.
3. Identify whether the pull request is merged, open, draft, closed unmerged, or blocked.
4. Incorporate relevant already-implemented changes into the plan.
5. Avoid duplicating work from merged or active pull requests unless the user explicitly asks for it.

## Start work

Before making code changes:

1. Set the requested Linear issue status to `In Progress`.
2. Assign the issue to the current user.
3. Confirm the local repository context and read [AGENTS.md](../../../AGENTS.md) and the sources it routes to before editing.
4. Create or update a concise implementation plan from the gathered context.

If assigning to the current user is ambiguous, identify the current user through the available Linear tool context. If that is not available, ask the user which Linear assignee to use before changing the assignee.

## Implementation workflow

Implement the issue end to end using the repository's existing conventions.

1. Inspect the relevant code before editing.
2. Prefer the smallest implementation that satisfies the Linear requirements and project context.
3. Include tests when the behavior, contract, or bug risk warrants them.
4. Run focused validation first, then broader validation when the change touches shared behavior.
5. Keep the Linear context in mind throughout, especially related issues and project-wide constraints.

If requirements conflict, are ambiguous, or force trade-offs, pause before implementation and offer the user the realistic options with the consequences of each. Continue only after the user chooses a direction.

## Completion

When implementation is complete:

1. Report the files changed and the behavior implemented.
2. Report the validation commands run and their results.
3. Call out any remaining risks, skipped checks, or follow-up work.
4. Do not mark the Linear issue done unless the user explicitly asks for that status change.
