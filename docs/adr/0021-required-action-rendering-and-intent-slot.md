# ADR 0021: Required action rendering and intent slot

- **Status:** Accepted.
- **Date:** 2026-09-29.
- **Decision owners:** Client composition maintainers.
- **Linear issue:** [ENG-2741](https://linear.app/shipfox/issue/ENG-2741/render-required-actions-through-one-component-and-an-intent-slot).
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md).

## Context

A required action tells the user how to resolve a policy notice. Five client components rendered it in four different ways. Four used an unchecked same-tab anchor. The duration notice accepted only absolute `http(s)` URLs and dropped relative and `mailto:` URLs.

A required action can now carry an optional `intent`, which names a behavior the composing application may provide in place of opening `url` ([ADR 0015](0015-usage-context-and-application-seams.md)). The composing application needs one place to handle it.

## Decision

`@shipfox/client-shell/runtime` exports `RequiredActionLink`, which every surface uses to render a required action. It renders through `RequiredActionDefaultLink`, which applies one URL rule and ignores `intent`:

| `url` | Rendered as |
| --- | --- |
| Application-relative path | Same-tab link |
| `http(s)` on the application origin | Same-tab link |
| `http(s)` on another origin | New-tab link with `rel="noreferrer noopener"` and no credentials |
| `mailto:` | Plain link |
| Anything else | The message as text |

`ChromeSlots` exposes an optional `RequiredActionIntent` component. `RequiredActionLink` renders it only for an action with an `intent`, and passes the default link as `fallback`, so the slot can render the default link for an intent it does not handle. The slot renders inside a reporting error boundary whose fallback is the default link. `RequiredActionTrigger` and `RequiredActionDefaultLink` are exported so a slot keeps the shared visuals and URL rule.

`defaultChrome` does not provide the slot. `RequiredActionLink` reads the chrome without requiring a provider, so a surface rendered outside a composed application shows the default link.

## Consequences

- Every surface applies the same URL rule, and the unchecked anchors are gone.
- The duration notice's billing link opens in the same tab, like every other surface.
- Self-hosted builds and applications without the slot keep working, because `url` is always a working fallback.
- A failing slot reports an error and shows the fallback link instead of removing the action.

## Rejected alternatives

### Make each surface handle `intent`

Five surfaces would each need the composing application's behavior, and each would drift. One component and one slot keep the behavior in one place.

### Omit the reporting boundary

An optional slot that throws would remove the only way to act on a limit. The boundary reports the failure and renders the working link.
