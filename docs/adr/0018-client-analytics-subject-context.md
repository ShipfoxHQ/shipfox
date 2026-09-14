# ADR 0018: Client analytics subject context

- **Status:** Accepted.
- **Date:** 2026-09-14.
- **Decision owners:** Client composition maintainers and client architecture.
- **Linear issue:** [ENG-2082](https://linear.app/shipfox/issue/ENG-2082).
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md)
  and [ADR 0013: Workspace setup composition seams](0013-workspace-setup-composition-seams.md).

## Context

The composing application needs authoritative user and workspace subjects for
explicit client analytics events. Feature packages cannot resolve those
subjects without depending on authentication and routing implementations.

The injected analytics implementation receives user email and name alongside
stable user and workspace IDs. This PII flow is part of the public composition
contract, even though the open-source client sends no telemetry by default.

## Decision

`ClientAnalytics.capture()` accepts an optional third argument with user and
workspace snapshots. The user contains `id`, `email`, and an optional `name`.
The workspace contains `id` and `name`.

The shell resolves this context at the root route boundary. It reads the
authenticated user and active routed workspace. A guest capture receives an
empty context. A capture outside a workspace omits the workspace.

Feature packages call `capture()` from event handlers or `useEffect`. They
don't call it during render or `useLayoutEffect`. The boundary updates its
subject snapshot during the commit layout phase, so a child layout effect can
run before that update during a subject transition.

The context remains independent of any analytics provider. The composing
application decides how to map the snapshot to its provider. The shell does not
expose access tokens, memberships, or broader authentication state.

The third argument is optional. Existing two-argument implementations remain
valid where TypeScript's function compatibility permits them. Coordinated
application releases can adopt the new argument without a prolonged mixed
version window.

## Consequences

- Every supported explicit capture receives the latest committed subject
  snapshot.
- Retained analytics references read the current snapshot when invoked.
- Composing applications receive user PII on each supported authenticated
  capture and own its provider-specific handling.
- Feature packages remain unaware of authentication and routing details.
- Layout-effect captures are outside the contract.
- The open-source client keeps its no-op default and gains no provider
  dependency.

## Rejected alternatives

### Resolve subjects in feature packages

This would duplicate context logic and expose authentication or routing details
across feature boundaries.

### Add a provider-specific implementation to the shell

This would couple the source-available package to one analytics provider and
change the opt-in composition boundary.

### Support captures from every React commit phase

Supporting child layout-effect captures needs a more complex commit-safe state
mechanism. Current consumers use event handlers or `useEffect`, so that
complexity has no current product benefit.
