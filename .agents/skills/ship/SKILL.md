---
name: ship
description: "Ship a Linear issue end to end: implement it, open the pull request, then loop on merge conflicts, CI failures, and review comments until the pull request is green and every review thread is handled, and keep it rebased on main until it merges. Trigger on /ship, ship ENG-123, or take an issue all the way to a reviewed pull request."
---

# Ship an issue

Take one Linear issue from implementation to a green, reviewed pull request.

## Input

`/ship <issue> [--max-iterations N] [--watch-minutes M]`

- `<issue>` is a Linear issue key, ID, or URL. If it is missing, ask for it and
  stop.
- `--max-iterations` caps the review loop. The default is 10.
- `--watch-minutes` sets how often the watch phase checks for conflicts. The
  default is 10.

## Process

1. Invoke the `implement-issue` skill with the issue. Follow it completely,
   including its pause when requirements conflict.
2. Invoke the `pr` skill. It commits pending changes through the `commit` skill
   and opens the pull request.
3. Record the pull request number with `gh pr view --json number,url`.
4. Run the loop below until a stop condition holds.
5. If the loop ended with CI green and no open comment, print the summary and
   enter the watch phase.

## Loop

Each iteration runs these steps in order.

### Sync with main

```bash
gh pr view <number> --json mergeable --jq .mergeable
```

GitHub reports `UNKNOWN` while it computes the result. Retry after a few
seconds. If the result is `CONFLICTING`, rebase on main:

1. Run `git fetch origin main` and `git rebase origin/main`.
2. Resolve each conflict so both the branch change and the main change survive.
   Regenerate generated files, such as `pnpm-lock.yaml` and migration snapshots,
   instead of merging them by hand.
3. Run the validation for the affected packages, as the `commit` skill selects
   it.
4. Push with `git push --force-with-lease`.

If a conflict needs a decision about the intent of the main change, abort the
rebase with `git rebase --abort` and ask the user.

### Wait for CI

```bash
gh pr checks <number> --watch --fail-fast --interval 30
```

`--fail-fast` returns on the first failure so the fix starts while other checks
still run.

CI can outlast a shell command timeout. Run the command in the background, or
run it again until it exits. Right after a push, checks may not be registered
yet. If the command reports no checks, wait a minute and retry.

If every check passes, continue to the review step. If a check fails, invoke
the `fix-ci` skill with the pull request number, then start the next iteration.

### Address review comments

Run this step only when CI is green. Invoke the `address-pr-comments` skill
with the pull request number. If it pushed commits, start the next iteration so
CI runs again.

## Stop conditions

Stop the loop when the first of these holds:

- CI is green and `address-pr-comments` found no open comment.
- The loop reached `--max-iterations`.
- The same check fails twice for the same reason after your fix.
- A rebase conflict or a review comment needs a decision from the user.

Do not merge the pull request or mark the Linear issue done.

## Watch phase

Every `--watch-minutes` minutes, check the pull request:

```bash
gh pr view <number> --json state,mergeable
```

- If `state` is `MERGED` or `CLOSED`, stop and print the final summary.
- If `mergeable` is `CONFLICTING`, run the loop again with a fresh iteration
  count. Its sync step rebases the branch.

Run each wait in the background if the shell has a command timeout.

## Summary

Print:

- The pull request URL and the stop reason.
- The iterations used out of the maximum.
- The final state of each check, and any rerun flaky check.
- The commits pushed during the loop, and each rebase on main.
- Comments fixed, declined, deferred, and still open, with links. Include any
  Linear issues created.
