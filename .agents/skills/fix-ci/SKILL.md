---
name: fix-ci
description: "Diagnose and fix failing CI checks on a pull request, then commit and push the fix. Trigger on /fix-ci, fix CI, CI is red, checks are failing, or fix the failing build on a PR."
---

# Fix CI

Find why a pull request's checks fail, fix the cause, and push the fix.

## Input

`/fix-ci [pr]`

`[pr]` is a pull request number or URL. Without it, use the pull request for
the current branch:

```bash
gh pr view --json number,url,headRefName
```

## Process

1. If checks are still running, wait for them. CI can outlast a shell command
   timeout, so run the command in the background or run it again until it
   exits:

   ```bash
   gh pr checks <number> --watch --fail-fast --interval 30
   ```

2. List the failed checks:

   ```bash
   gh pr checks <number> --json name,bucket,link --jq '.[] | select(.bucket == "fail")'
   ```

   Each `link` has the form `.../actions/runs/<run-id>/job/<job-id>`. If
   nothing failed, report that and stop.

3. Read the failure from the job log. For E2E failures, download the
   diagnostics artifact before you form a theory:

   ```bash
   gh run view <run-id> --job <job-id> --log-failed
   gh run download <run-id> -n e2e-diagnostics -D .context/ci/<run-id>
   ```

4. Reproduce the failure locally with the matching `turbo` task and package
   filter. Read the
   [local development and release workflow](../../../docs/guides/local-development-and-release-workflow.md)
   to pick the task.
5. Fix the cause. Do not skip, weaken, or delete a test to make it pass.
6. If the failure is unrelated to the diff, such as a known flaky test or an
   infrastructure error, rerun only the failed jobs once instead of changing
   code:

   ```bash
   gh run rerun <run-id> --failed
   ```

7. Commit the fix through the `commit` skill and push with `git push`.

## Report

Report each failed check with its cause and outcome: fixed in a commit, rerun
as unrelated, or not fixed with the reason. Include the commit hashes pushed.
