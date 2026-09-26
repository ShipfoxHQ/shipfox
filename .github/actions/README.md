# CI setup actions

`setup-mise`, `setup-pnpm` and `setup-playwright` install the mise tools, the
pnpm dependencies and the Playwright browsers a CI job needs, and cache them
between runs.

## Cache trust model

This repository is public, so a pull request can run any code in its jobs.
Only `main` may write caches. A pull request reads the last cache that `main`
wrote, and the runner discards the pull request's own changes to it.

| Runner | Cache | What limits writes to `main` |
| --- | --- | --- |
| Blacksmith (`blacksmith-*`) | [Sticky disks](https://docs.blacksmith.sh/blacksmith-caching/dependencies-sticky-disks) | Branch protection for sticky disks, in the Blacksmith dashboard settings. Only `push`, `schedule` and `workflow_dispatch` jobs on the default branch commit a snapshot. |
| GitHub-hosted | `actions/cache` or the `jdx/mise-action` cache | The save steps run only when `github.ref` is `refs/heads/main`. GitHub also scopes caches written by a pull request to that pull request. |

Keep sticky-disk branch protection turned on. A pull request can edit these
actions, so the workflow files can't enforce the rule for Blacksmith runners.
The Blacksmith setting is the control.

When the setting is on, each sticky disk in a pull request job logs `Sticky
disk changes will not be committed for this job (branch protection: ...)`.

## Sticky disks

The actions detect a Blacksmith runner through `BLACKSMITH_VM_ID`.

| Action | Path | Key |
| --- | --- | --- |
| `setup-mise` | `~/.local/share/mise` | One disk per tool list |
| `setup-pnpm` | The parent of `pnpm store path`, which also holds the pnpm cache | One disk per OS and architecture |
| `setup-pnpm` | The root `node_modules`, for unfiltered installs only | One disk per OS, architecture, Node version and pnpm version |
| `setup-playwright` | `~/.cache/ms-playwright` | One disk per Playwright version |

The disks use `commit: on-change`, so a job that changes nothing doesn't take a
new snapshot. A filtered pnpm install never saves the store, on either runner,
because it only holds part of it. It doesn't mount the `node_modules` disk.

To reset a disk, bump the `v1` in its key. Blacksmith evicts a disk after 7
days without use.
