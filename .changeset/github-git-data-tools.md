---
"@shipfox/api-integration-github": minor
---

Rework the `create_commit` GitHub tool onto GitHub's Git database API and add `create_blob`. A commit is now a list of tree entries on top of `parent_oid`, so it can hold file modes, symbolic links, submodules, and files up to 40 MiB each, and is still signed by GitHub as the Shipfox bot. `create_commit` creates a missing branch, requires a fast-forward otherwise, and resets the branch with `force`. An optional `expected_head_oid` checks the branch head before either move. The earlier `additions` and `deletions` arguments are gone, with the 1,000,000-byte limit and the `CREATE_COMMIT_ON_BRANCH_MUTATION` export.

Add the `delete_branch` GitHub tool. It refuses the default branch, treats a branch that is already gone as a success, and deletes only a branch that still points at `expected_head_oid` when that argument is set.

Add the read tools `get_repository`, `get_branch`, `get_commit`, and `compare_commits`. `get_repository` returns the default branch and `bot_login`, the login of the Shipfox bot. `get_branch` answers `exists: false` for a missing branch. Commits come back with parents, author and committer identities, and whether GitHub verified them.

`create_pull_request` takes `labels`, `assignees`, and `milestone`. `update_pull_request` takes additive `add_labels` and `add_assignees`, `milestone`, and `draft` to convert an open pull request to a draft or mark it ready for review. These are applied after the pull request is saved, and a failure is reported under `warnings` in the result instead of failing the call. A failed reviewer request is now a warning too, where it failed the call before.
