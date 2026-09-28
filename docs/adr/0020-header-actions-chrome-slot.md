# ADR 0020: Header actions chrome slot

- **Status:** Accepted.
- **Date:** 2026-09-28.
- **Decision owners:** Client composition maintainers.
- **Linear issue:** [ENG-2604](https://linear.app/shipfox/issue/ENG-2604/add-a-headeractions-chrome-slot-to-the-client-shell).
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md).

## Context

Cloud needs to add an application-specific action beside the shell-owned Docs link. The action can depend on routed workspace context, while the shell must remain independent of Cloud features.

## Decision

`ChromeSlots` exposes an optional `HeaderActions` component. The shell renders it in the application header before Docs and inside a reporting error boundary whose fallback is empty. The component may return `null`.

The slot is rendered by `ApplicationHeader`, which mounts inside the composed router. It can therefore use routed shell hooks such as `useMaybeActiveWorkspace()`. `defaultChrome` does not provide the slot.

## Consequences

- Composing applications can add header actions without a shell-to-feature dependency.
- A failing header action reports an error without interrupting the header or the routed application.
- Existing compositions and self-hosted builds keep their current header because the slot is optional.

## Rejected alternatives

### Use a feature registry or feature-specific injection

A runtime feature registry would conflict with ADR 0001's explicit compile-time feature composition contract. Feature-specific injection would couple the shell to a feature-owned implementation. The browser-only `ChromeSlots` contract keeps application composition explicit and the shell independent.

### Omit the reporting boundary

Without `ReportErrorBoundary`, an optional header action could interrupt the shell when its render fails. The local boundary reports and isolates slot failures while preserving the header and routed application.
