---
"@shipfox/client-workflows": patch
---

Replace the local `StatusDot` in the workflow runs list with the shared `Dot`
component from `@shipfox/react-ui`, mapping run status to the dot's native color
variant. Active (running) runs show a blue rippling dot.

Refine the selected run row: drop the washed-out orange-tinted fill and border in
favor of a subtle neutral surface plus the existing orange "you are here" rail, so
selection reads as intentional restraint rather than a faint brand wash.

Re-align the status filter buttons to native `Button` variants instead of
hardcoded highlight tokens: the active filter uses `primary`, the rest
`transparent`.

Tidy the runs list header: drop the redundant "Runs" title (already shown in the
section selector above) and align the header inset with the run rows so the search
box, filters, and run cards share one left edge.

Match the runs list panel surface to the nav bar chrome: use
`bg-background-subtle-base` (instead of a solid `bg-background-neutral-base` panel
fill) so it reads as app chrome rather than a dedicated card, keeping only the
right-edge separator.
