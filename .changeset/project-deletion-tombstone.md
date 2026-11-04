---
"@shipfox/node-drizzle": minor
"@shipfox/api-projects": minor
"@shipfox/api-projects-dto": minor
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
---

Adds project deletion. An admin deletes a project with `DELETE /projects/:projectId` and repeats its name to confirm. The project disappears at once, and its slug and linked repository can be reused. The default project can't be deleted.

- **Projects:** a delete sets `deleted_at` and `deleted_by` on the project row and writes `PROJECT_DELETED`. Every read skips deleted projects, except the admin list, which shows them with `status` `deleted` and `deleted_at`. The module deletes its own access rows and event dedup rows when it consumes the event.
- **Contract:** `getProjectsByIds` returns the name, slug, and `deletedAt` of projects, and shows deleted ones with `includeDeleted`.
- **Agent access:** `find_projects` returns `deleted_at`, null for a live project, because the admin list now includes deleted projects.
- **Drizzle:** `@shipfox/node-drizzle` adds `deletedScopeColumns`, `recordDeletedScope`, `assertScopeWritable`, `ScopeDeletedError`, and `deleteInBatches`. A module can use the marker helpers to block writes to a deleted project. The projects module uses `deleteInBatches` to purge its event dedup rows.
