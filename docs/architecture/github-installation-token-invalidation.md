# GitHub installation-token invalidation

This document defines the cluster consistency contract for cached GitHub App installation tokens.
It applies after the `installation.new_permissions_accepted` cleanup requested by the webhook lifecycle.

## Consistency contract

The token cache uses a per-installation `GENERATION` fence in a durable namespace beside the existing GitHub installation-token namespace.
Token namespace deletion does not remove the fence.
The fence is not an approved-permission snapshot.

An invalidation operation performs these steps under the installation-wide compatibility lock:

1. Write a new random generation.
2. Delete the existing installation-token namespace.
3. Confirm the generation remains published after namespace deletion.

The generation write is the invalidation linearization point.
A token envelope is valid only when its generation matches the current fence.
Legacy envelopes without a generation remain valid only while no generation has been published.

Every new-version API replica checks the shared generation before it serves a RAM or shared-tier result.
It checks the fence again after a RAM lookup or a contended shared lookup.
An in-flight mint must pass the same check before it writes or returns its result.
A mint that crosses the fence is discarded and retried against the new generation.

After the fence is published, a request that reaches its final fence check cannot serve a pre-fence token.
A request that completed its final check before the fence was published may finish with its already selected token.
The default lock retry window is 2 seconds, which is the cache coordination bound for lock contention.
Secret-store operation latency and GitHub mint latency remain part of the surrounding request SLO.

Permission profiles retain independent token and backoff keys.
The generation fence covers every profile without merging their permissions.
Terminal backoff entries remain profile-scoped or installation-scoped according to their existing error classification.

## Failure and degradation behavior

The cache fails closed when a generation read cannot complete.
It does not serve a RAM or shared-tier token without verifying the fence.
Requests return `provider-unavailable` until the shared secret store can be read again.

An invalidation write or namespace deletion failure rejects cleanup after the webhook transaction commits.
The stored webhook delivery remains retryable, so a duplicate delivery retries the cleanup.
The cleanup restores the generation in a `finally` path when namespace deletion fails after the fence was written.

A mint can complete after invalidation because GitHub requests cannot be cancelled.
The generation check prevents that result from repopulating the shared namespace or the local RAM cache.
The caller waits for a fresh mint or receives the existing provider failure.

## Mixed-version rollout

The cluster guarantee begins only after every API replica that can serve GitHub tokens runs the fence-aware version.
Older replicas do not read `GENERATION` and can continue serving their local RAM entry until it expires.
They can also write generation-less envelopes and backoff entries.
New replicas discard those values or cannot share their backoff, which can cause extra mints and weaker shared backoff until all old replicas drain.
Drain older replicas before relying on approval invalidation, or pause permission approvals during the rollout.

The new reader accepts legacy envelopes while the fence is absent.
After the first new-version invalidation publishes a fence, it rejects those envelopes and mints a fresh token.
This permits a rolling data migration without persisting an approved-permission snapshot.

## Operational checks

Monitor `provider-unavailable` outcomes from generation reads and invalidation lock contention.
A sustained increase means the shared secret store or the installation advisory lock is degraded.
Do not disable the generation read as a recovery shortcut.
Doing so would allow a stale RAM result to bypass the consistency contract.

The webhook behavior remains unchanged.
The existing installation namespace deletion and durable reject-and-retry cleanup path remain the source of invalidation requests.
This design does not add a permission preflight or a check-specific permission request.
