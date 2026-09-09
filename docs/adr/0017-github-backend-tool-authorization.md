# Architecture decision record 0017: Full installation access for backend GitHub tools

- **Status:** Accepted.
- **Date:** 2026-09-09.
- **Decision owners:** Integrations and Agent maintainers.
- **Linear issue:** [ENG-2038](https://linear.app/shipfox/issue/ENG-2038/use-full-installation-access-for-backend-github-tools).
- **Related:** [GitHub authorization product spec](https://linear.app/shipfox/document/github-backend-tool-authorization-product-spec-f3053280d42e), [GitHub authorization system design](https://linear.app/shipfox/document/github-backend-tool-authorization-system-design-f56109f0d2cb), and the [GitHub agent-tool catalog](../../libs/api/integration/github/src/core/github-agent-tool-catalog.ts).

## Context

Backend GitHub tools previously derived a permission profile from selected catalog
entries and performed a local permission preflight from the minted token metadata.
That narrowed token could reject an operation that GitHub would allow. It also
blocked workflow-file commits before GitHub could apply its own installation and
repository rules.

The tool catalog remains useful for documenting provider requirements, but its
permission fields cannot be the credential or authorization boundary.

## Decision

Backend GitHub tools request the existing full installation access token with the
installation ID only. They do not derive token permissions, repository selectors,
or permission fingerprints from selected tools. Existing cache identity, persisted
keys, locking, and provider signatures remain unchanged.

The catalog's `requiredScope` and `alternativeScopes` fields remain published as
advisory metadata for documentation and diagnostics. GitHub is the authority for
provider permission decisions. Authorized workflow-file writes reach GitHub and
surface its success or denial without a local workflow-file preflight.

Shipfox continues to authorize the caller, workspace, connection, selected tools
and methods, write access, arguments, and declared repository targets before the
provider call. Checkout credentials keep their existing exact repository scope.
Provider operation denials are not token-mint failures: they do not invalidate,
remint, or replay the write.

## Consequences

Installation grants are the effective provider credential boundary, so the
installation must be configured with the intended access. Shipfox authorization
checks remain necessary to prevent an otherwise valid installation token from
being used outside the workflow's selected scope. Mixed-version deployments can
temporarily contain replicas using the previous token behavior.

Error mapping distinguishes Shipfox validation from provider outcomes and only
classifies a permission denial as `access-denied` when GitHub supplies evidence for
that classification. Ambiguous provider responses remain provider rejections.

## Non-goals

This decision adds no tools, settings, GitHub App grants, repository semantics, or
checkout scope. Removal of obsolete permission-profile cache data is handled by
[ENG-2039](https://linear.app/shipfox/issue/ENG-2039/remove-obsolete-github-tool-permission-profile-cache-data),
and shared-cache cleanup follows in
[ENG-2040](https://linear.app/shipfox/issue/ENG-2040/remove-obsolete-github-tool-permission-profile-cache-keys).
