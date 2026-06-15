---
"@shipfox/api-integration-github": patch
"@shipfox/api-integration-sentry": patch
---

Harden integration connect against a concurrent same-install race. The installation upsert now only (re)points an installation at the connection that already owns it: the `onConflictDoUpdate` carries a `setWhere(connection_id = this connection)` predicate and throws `*InstallationAlreadyLinkedError` when the conflicting row belongs to a different connection. Two concurrent connects of the same provider install to different workspaces no longer leave one workspace with an active orphan connection while the install's webhooks silently route to the other; the losing transaction rolls back and surfaces a 409.
