# ADR 0026: Project dock contribution

- **Status:** Accepted.
- **Date:** 2026-10-31.
- **Decision owners:** Client composition maintainers.
- **Linear issue:** [ENG-3134](https://linear.app/shipfox/issue/ENG-3134/add-the-project-dock-shippy-placement-and-page-context-to-the-shell).
- **Amends:** [ADR 0001: Public client composition contract](0001-client-composition-contract.md).

## Context

Chat with Shippy has no route. It lives beside every project page, and it must keep running as the user moves between those pages.

Routes can't express this, because a route replaces the page. A chrome slot would work, but each composing application would have to wire it, and a composition that forgot would ship without chat. Chat also needs to know the current page, and `status` is known only after a page loads its data, so route metadata can't carry it.

## Decision

`ClientFeature` gains an optional `projectDock` contribution with one `load` function, which returns a dynamic import. A composition may contain one. A second one fails composition with this message, which joins the contract in ADR 0001:

`Project dock is contributed by both features "<first>" and "<second>".`

`load` keeps the manifest Node-safe and keeps the chat code out of the first bundle. The shell wraps the result in `React.lazy` and `Suspense`.

The shell mounts the component on project pages, beside `main`, inside a reporting error boundary. It doesn't mount it on workspace pages, focused frames, or the pre-project gate.

- **Lifetime.** The component stays mounted across project pages, and while the panel is closed. It remounts when the workspace or the project changes, because a project slug is unique only within its workspace. A closed dock can therefore keep polling, hold a stream, and listen for its shortcut.
- **Failure.** A failed dock loses its launcher and page strip, and the stored open flag clears, so the user is never left with a launcher that opens nothing. The shell retries on navigation, with a new `React.lazy` each time, up to three attempts per project. Return visits don't refill those attempts until the page reloads. Each attempt reports its error.
- **Panel.** The component draws its surface through `ProjectDockPanel` from `@shipfox/client-shell/runtime`. At 976px and wider the panel is a 400px `aside` that pushes the page, with no focus trap. Below that it is a modal, full-screen `Sheet`, and a stored open flag isn't restored on page load. State that must outlive a closed panel or a crossed breakpoint stays above `ProjectDockPanel`. The contribution must render its own close control, because the shell draws none and a touch screen has no other way out of the sheet.
- **Launcher.** The shell owns Shippy's launcher, its `floating` or `tab_bar` placement, and the page strip, because they belong to the frame. Placement and open state are stored per browser. Below 976px placement is always `tab_bar`.
- **Page strip.** In floating mode with the panel closed, `main` stops 72px above the window's floor, the height Shippy needs. The frame's bottom padding drops by 16px, so a page that fills its frame gives up the specified 56px. Padding alone would scroll with the page and let content pass under Shippy.
- **Page context.** `useAgentPageContext` lets a page publish where the user is, and `useCurrentAgentPageContext` reads it. The value clears when the page unmounts. The shell keeps one value, so each page publishes once and layouts don't publish. It is a hint, so the API checks every id it receives.

## Consequences

- One contribution adds a dock to every composing application that includes the feature.
- With no contribution, the shell renders no launcher, no strip, and no `Shippy` control.
- The application frame always wraps `main` and the navigation strip in a column beside the dock. The strip's tablist moves inside a wrapper, so it can hold the discreet launcher without giving a `tablist` a non-tab child.
- Shell code names Shippy. The launcher, its copy, and its placement aren't generic, and a second kind of dock would need them moved.
- Crossing 976px remounts everything below `ProjectDockPanel`.
- The dock is a separate chunk. A tab left open across a deploy can fail to load it, and if the old chunk is gone only a reload recovers it. The page keeps working without the dock.

## Rejected alternatives

### A chrome slot

Each application would have to wire it, and it would stay out of the feature that owns chat. Features already carry everything else that reaches every composition.

### A route implementation string

`impl` keeps a module out of Node evaluation, but it needs generated code and a new path into `composeClientApp`. `load` gives the same safety with no generator change.

### A `Component` that authors wrap in `React.lazy`

This matches `FeatureProvider`, but React caches a rejected import inside the `lazy` component. The shell could never retry a failed load, so one failed chunk would end the dock until a reload.

### Mount the component only while the panel is open

This is simpler, but the closed panel still has to show unread replies and answer `Mod+.`. Both would need a second seam.

### One host that moves the same DOM between the `aside` and the `Sheet`

A portal into a detached element would keep the panel's DOM across the breakpoint. It adds a hard-to-read mechanism for a rare resize, and feature state above `ProjectDockPanel` already survives it.
