---
"@shipfox/api-integration-github": major
"@shipfox/api-integration-github-dto": major
"@shipfox/client-integrations": major
---

Lets a member choose among several linkable GitHub installations. `POST /integrations/github/link/complete` now returns up to 20 candidates with a five-minute signed selection token, and `POST /integrations/github/link/select` connects the chosen installation. More candidates return `github-too-many-linkable-installations`, which replaces `github-multiple-linkable-installations` and `GithubMultipleLinkableInstallationsError`. `GithubApiClient.listUserInstallations` now returns installation details instead of IDs. The GitHub callback page shows the installation picker, and `completeGithubLink` can now return a selection instead of a connection.
