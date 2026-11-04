# @shipfox/api-projects-dto

## 34.0.0

### Major Changes

- e6981d5: An integration connection no longer has a repository access mode. Every connection reaches all repositories its installation can see, and projects narrow access instead.

  - **Release note:** a connection that was set to **Only your projects' repositories** now reaches every repository its installation sees. A project with full access can use all of them. This migration sets every connection to the open behavior and removes the setting. To narrow a project, limit its access.
  - **Integration SPI:** `IntegrationConnection` no longer has `repositoryAccessMode`, and `IntegrationConnectionRepositoryAccessMode` is gone.
  - **Integration core DTOs:** the `CONNECTION_REPOSITORY_ACCESS_CHANGED` event and the repository access schemas are gone.
  - **Projects DTOs:** the inter-module method `listProjectsBySourceConnection` is gone.
  - **API:** `GET` and `PUT /integration-connections/:connectionId/repository-access` are removed. The `repository_access` column is dropped from connections and secret cleanups.
  - **Integration core:** `IntegrationConnectionRepositoryAccessMode` is no longer exported from the package root.
  - **Client:** the connection page no longer has a repository access section, and the connection menu no longer offers **Manage repository access**. Use **Open in GitHub** to change the repositories on GitHub. `RepositoryAccess`, `RepositoryAccessMode`, `RepositoryAccessRepository`, `listIntegrationConnectionRepositoryAccess`, `updateIntegrationConnectionRepositoryAccess`, and the matching query hooks are no longer exported.

### Minor Changes

- 46f78a0: Adds `find_workspaces` and `find_projects` to the admin MCP endpoint `POST /mcp/admin`. Both need the `admin-observer` role and no impersonation window. `search` matches part of a name or slug, or an exact ID when it is a UUID. Leave it out to list every workspace or project. `find_workspaces` also filters by `status`. Each project names its `workspace_id` and `workspace_slug` for `start_impersonation`. The admin endpoint now needs a projects client. The Workspaces contract adds `listAdminWorkspaces`, and the Projects contract adds `listAdminProjects`. The `GET /admin/workspaces` and `GET /admin/projects` searches now match slugs as well as names.
- 7fddfc5: A checkout-token refusal for an explicit `checkout.project` names the repository when the project has a source owner and name. `resolveCheckoutTarget` returns both as `sourceRepositoryOwner` and `sourceRepositoryName`.
- b59424d: A managed project whose access lists one source-control connection, limited to exactly one repository, checks it out by default, at the revision of the repository itself.

  - **Default checkout:** a job that sets no `checkout` on such a project checks out that repository. A repository written without a connection uses the one source-control connection the project lists, and the workspace's only one when the project has access to all connections. Run admission checks the default checkout's connection.
  - **Revision:** a checkout uses the commit of the triggering event when the event came from the checked-out repository, matched by connection and repository, whether or not a project uses that repository as its config source. This also fixes `repository:` checkouts of a repository that isn't a config source, for every project. A change to the managed config checks out the repository's default branch.
  - **Contract:** `listSourceControlConnectionIds` lists a workspace's active source-control connections. Run trigger references carry optional `connectionId` and `externalRepositoryId`, and runs created before this release keep the comparison by project. `@shipfox/api-projects-dto` exports `defaultConnectionId`.

- dd63da9: Gives every workspace a default project that answers the Slack and Linear requests no other agent claims.

  - **Projects:** a new workspace gets an empty managed project named Default. A workspace made before this release gets its own when the first page of its project list is read without a search, or when its default project is read, so no backfill step is needed. A renamed default keeps its flag.
  - **Contract:** projects carry `is_default` (`isDefault` between modules), and `getDefaultProject` returns the default project of a workspace.
  - **Agent:** an unclaimed request starts a conversation in the default project, not the oldest one.
  - **Client:** the projects hub, the project switcher, the project breadcrumb, and the project settings show a Default badge. The setup gate ignores the default project when it checks whether a workspace has a project.

- 1872f3d: Move a managed project to a repository.

  - **Routes:** `POST /projects/:projectId/config/link` checks the target and refuses with `config-exists`, `repository-in-use`, `repository-empty`, `connection-inactive`, or `link-unsupported`. With `dry_run: true` it stops there. Otherwise it makes the managed repository read-only, opens a pull request that adds `.shipfox/`, moves the project's config source, and finishes. A stopped move answers `503 move-unconfirmed`, and the next call resumes the stored attempt without opening a second pull request. `POST /projects/:projectId/config/link/pull-request` opens a new one after a closed pull request. Impersonated sessions are refused on both.
  - **Config read:** `GET /projects/:projectId/config` and `getConfigSource` return the move and the pull request state. A merged pull request clears its stored URL.
  - **Providers:** the source-control SPI gains `openConfigPullRequest` and `getConfigPullRequest`, idempotent on the branch. GitHub implements both.
  - **Projects:** the inter-module contract gains `moveProjectSource`, which moves a project's config source to the linked repository.
  - **E2E setup:** `mergeTestVcsPullRequest` and `closeTestVcsPullRequest` drive a Test VCS pull request.

- 0af8bad: Adds projects with a managed repository, behind the `managed-config-repos` workspace flag. `POST /projects` accepts a managed source, the project DTO gains `source.kind`, and the workspace's hidden connection stays out of every list. A job with a default checkout on a managed project now explains how to fix it.
- cdb88a7: A project can store and read its access: the connections it can use and, for each, the repositories it can reach. Nothing enforces it yet.

  - **Projects:** `GET` and `PUT /projects/:projectId/access`, with admin-only writes. A linked project's config connection can be saved with zero repositories, which means only the config repository. A repository rename updates the stored names of a listed repository.
  - **Projects DTO:** a browser-safe access evaluator and the policy types, and `getProjectAccessPolicy` and `getProjectAccessPolicies` on the inter-module contract.
  - **Integrations:** providers can declare `resourceKinds` and implement `listScopeResources` and `resolveScopeResource`. GitHub and Gitea do so for repositories. `GET /integration-connections/:connectionId/scope-resources` serves the picker, and `getScopeConnection` and `resolveScopeResource` join the inter-module contract.
  - **Connection deletion** of every kind writes `integrations.connection.deleted`, and Projects removes the matching scopes.

- f8adab0: Adds project deletion. An admin deletes a project with `DELETE /projects/:projectId` and repeats its name to confirm. The project disappears at once, and its slug and linked repository can be reused. The default project can't be deleted.

  - **Projects:** a delete sets `deleted_at` and `deleted_by` on the project row and writes `PROJECT_DELETED`. Every read skips deleted projects, except the admin list, which shows them with `status` `deleted` and `deleted_at`. The module deletes its own access rows and event dedup rows when it consumes the event.
  - **Contract:** `getProjectsByIds` returns the name, slug, and `deletedAt` of projects, and shows deleted ones with `includeDeleted`.
  - **Agent access:** `find_projects` returns `deleted_at`, null for a live project, because the admin list now includes deleted projects.
  - **Drizzle:** `@shipfox/node-drizzle` adds `deletedScopeColumns`, `recordDeletedScope`, `assertScopeWritable`, `ScopeDeletedError`, and `deleteInBatches`. A module can use the marker helpers to block writes to a deleted project. The projects module uses `deleteInBatches` to purge its event dedup rows.

### Patch Changes

- Updated dependencies [7ea02c4]
  - @shipfox/api-common-dto@34.0.0

## 23.2.0

### Patch Changes

- Updated dependencies [a5c2ebd]
  - @shipfox/api-common-dto@23.2.0

## 21.0.0

### Minor Changes

- 879f227: Adds GitHub authorization state for selected and all repository access.
- 5886bf2: Make selected repository access project-only and remove manual repository grants.

## 20.0.0

### Major Changes

- ec39327: Projects checkout resolution now requires a project ID and no longer accepts repository names. Checkout requests authorize the repository target before issuing credentials. Repository declarations remain valid without a project association.

### Minor Changes

- 533b968: Adds a paginated Projects contract for project repositories bound to a source connection.

## 19.0.0

### Minor Changes

- 5af8d52: Adds project catalog and workflow-definition reads, plus trigger-event summaries, details, and facets.
- a225bf8: Adds a case-insensitive project lookup contract for source repository owner and name.

### Patch Changes

- @shipfox/api-common-dto@15.0.0
- @shipfox/inter-module@0.2.3

## 15.0.0

### Patch Changes

- @shipfox/api-common-dto@15.0.0

## 14.0.0

### Minor Changes

- a4df8d9: Resolves a workflow lineage id on GET /definitions/:id by selecting the project's default-branch row, or 404 when the file is not on that branch.

## 12.2.0

### Minor Changes

- 7901a60: Retry workspace workflow definition syncs when an integration connection becomes available.

## 12.0.0

### Major Changes

- 4eb18b8: Add required, workspace-scoped project slugs across the API and project creation form.

### Minor Changes

- 8cc5a36: Add a `resolveCheckoutTarget` inter-module method. It resolves a project by ID
  or by owner and repository within a workspace for callers that authorize a
  checkout target.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- Updated dependencies [f78740d]
- Updated dependencies [34a5639]
  - @shipfox/api-common-dto@12.0.0
  - @shipfox/inter-module@0.2.3

## 10.1.0

### Minor Changes

- 88ae689: Add a bounded, administrator-authorized project summary route with redacted fields and cursor pagination.

## 10.0.0

### Minor Changes

- e9280fc: Add an observer-authorized administrator workspace lookup with bounded safe summaries,
  best-effort job counts, and a neutral unavailable-workspace member experience for
  suspended or deleted workspaces.

### Patch Changes

- @shipfox/api-common-dto@9.2.0
- @shipfox/inter-module@0.2.2

## 9.2.0

### Patch Changes

- Updated dependencies [36d8338]
  - @shipfox/api-common-dto@9.2.0

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-common-dto@9.0.2
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-common-dto@9.0.1
  - @shipfox/inter-module@0.2.1

## 8.0.0

### Major Changes

- 7f227c6: Moves Projects and Integrations synchronous contracts to producer-owned inter-module entry points.

## 6.0.0

### Patch Changes

- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
  - @shipfox/api-common-dto@6.0.0
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-common-dto@5.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-common-dto@2.0.0

## 0.1.0

### Minor Changes

- 43fd0c1: Adds HTTP-first E2E project setup contracts and routes for creating synthetic projects without source-control setup.

### Patch Changes

- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- Updated dependencies [27770eb]
  - @shipfox/api-common-dto@0.1.0
