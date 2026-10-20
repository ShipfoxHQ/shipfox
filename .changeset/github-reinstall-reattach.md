---
'@shipfox/api-integration-github': minor
'@shipfox/api-integration-github-dto': minor
'@shipfox/api-integration-core': minor
'@shipfox/e2e-setup-integrations': minor
---

Reinstalling the Shipfox GitHub App for the same GitHub account in a workspace reattaches the existing connection instead of creating `github_<owner>_2`. Its ID, slug, project bindings, and workflows stay, and a disabled or errored connection becomes `active` again, or stays `error` if GitHub reports the new installation suspended. Installations record GitHub's account ID, and the E2E connect route accepts one.
