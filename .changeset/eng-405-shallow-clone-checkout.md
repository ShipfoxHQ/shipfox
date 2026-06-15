---
"@shipfox/runner-workspace": patch
"@shipfox/runner-execution": patch
"@shipfox/runner-protocol": patch
---

Implement the repository checkout inside the runner's "Set up job" step. The setup
step now ensures `git` is available, exchanges the job lease for short-lived
read-only checkout credentials via the checkout-token endpoint, and shallow-clones
the project repository's default branch into the per-job directory. Every failure
mode (missing `git`, denied credential, unreachable provider, generic clone failure)
fails the job before any user step runs with a machine-readable `reason`. Credentials
are injected with a one-shot `http.extraHeader`, never persisted to `.git/config`,
and redacted from error messages.
