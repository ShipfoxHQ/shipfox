---
"@shipfox/api-projects-dto": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

A managed project whose access lists one source-control connection, limited to exactly one repository, checks it out by default, at the revision of the repository itself.

- **Default checkout:** a job that sets no `checkout` on such a project checks out that repository. A repository written without a connection uses the one source-control connection the project lists, and the workspace's only one when the project has access to all connections. Run admission checks the default checkout's connection.
- **Revision:** a checkout uses the commit of the triggering event when the event came from the checked-out repository, matched by connection and repository, whether or not a project uses that repository as its config source. This also fixes `repository:` checkouts of a repository that isn't a config source, for every project. A change to the managed config checks out the repository's default branch.
- **Contract:** `listSourceControlConnectionIds` lists a workspace's active source-control connections. Run trigger references carry optional `connectionId` and `externalRepositoryId`, and runs created before this release keep the comparison by project. `@shipfox/api-projects-dto` exports `defaultConnectionId`.
