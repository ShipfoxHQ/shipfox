---
"@shipfox/api-triggers": minor
"@shipfox/api-definitions": minor
"@shipfox/api-secrets": minor
"@shipfox/api-cache": minor
"@shipfox/api-agent": minor
"@shipfox/api-integration-core": minor
---

Purges the configuration and conversations of a deleted project. After a project is deleted, its subscriptions, definitions, secrets, cache entries, conversations, and managed repository are removed, and a late event can't bring any of them back. A repository the project linked is not touched.

- **Deletion markers:** Triggers, Definitions, Secrets, Cache, and Agent each add a `deleted_scopes` table. Each module records a marker when it consumes `PROJECT_DELETED`, and every write to a project row checks it. A late `definition_resolved`, sync, cache reserve, or conversation start for the project creates nothing. Routes answer `project-not-found`.
- **Triggers:** removes subscriptions, which remove their cron schedules, agent subscriptions, listener subscriptions, and decisions. Listener decisions now store the project id. `decisions` gains a `project_id` index.
- **Definitions:** removes workflows, definitions, agents, and sync states. Action snapshots are shared by digest, so it removes only the snapshots of the deleted project that no live definition references.
- **Secrets and Cache:** remove the project's secrets, variables, and cache entries. Cache also deletes the stored objects.
- **Agent:** stops running turns, then removes conversations with their items, turns, stream chunks, and reply deliveries, then sessions with their stored objects. A conversation with a running turn waits for the next delivery of the event. `sessions` gains a `project_id` index.
- **Integrations:** deletes the project's managed repository with its objects and refs.
