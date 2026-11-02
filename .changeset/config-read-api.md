---
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-github": minor
---

Read a project's config from whichever repository is active.

- **Integrations contract:** `getConfigSource`, `listConfigFiles`, `readConfigFile`, and `listConfigCommits`. A project in another workspace answers `project-not-found`, and a provider without `listCommits` answers `history-unsupported`.
- **HTTP:** `GET /projects/:projectId/config`, `/config/files`, `/config/files/*`, and `/config/commits`. Reads stay under `.shipfox/`, and the source comes from the project row, so it answers during a provider outage.
- **GitHub:** `listCommits` on the source-control provider and `listCommits` on `GithubApiClient`, which lists the commits that changed a path and pages with GitHub's next link.
