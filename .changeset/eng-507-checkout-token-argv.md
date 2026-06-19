---
"@shipfox/runner-workspace": patch
---

Keep the checkout credential out of the git process argv. The runner now injects the
`http.extraHeader` Authorization through env-based git config (`GIT_CONFIG_*`, which requires
git 2.31+) instead of a `-c` CLI argument, so the token is no longer readable via `ps` or
`/proc/<pid>/cmdline` while a clone runs, and the inherited git config-injection environment is
stripped from every git child. The setup step now fails with `git_unavailable` on git older
than 2.31, and credential redaction adopts the shared `@shipfox/redact` helpers.
