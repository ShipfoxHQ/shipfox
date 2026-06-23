# Design System — Shipfox

Source of truth for visual and interaction decisions. Read this before writing any UI.

The system is already built. The CSS lives in `libs/shared/react/ui/index.css` (chicago workspace) and the broader catalog of tokens and components lives in the shared `@shipfox/react-ui` package. This document explains what the system is and why it is shaped this way. It does not prescribe what individual product pages should look like — surface-level designs live with the features they belong to.

---

## 1. Product Context

**What this is.** A multi-tenant, distributed workflow execution platform. Users define DAGs of jobs in YAML, push to VCS, and runs are kicked off by triggers (webhook, schedule, manual). Jobs execute on runners we don't own (the user runs them in their own infra). Steps are either server-side (HTTP, notify, conditional) or worker-side (commands on a runner).

**Who it's for.** Platform engineers, infra teams, and developers who want CI/CD-shaped workflow execution without giving up control of where the work runs. They live in terminals. They read logs at 2am. They expect data density, monospaced numbers that don't dance, keyboard-first navigation, and zero patience for marketing fluff.

**Space/industry.** Developer platform / build & deploy / workflow orchestration. Peers: GitHub Actions, GitLab CI, Buildkite, CircleCI, Argo Workflows, Temporal Cloud, Linear, Vercel, Resend.

**Project type.** Web application (dashboard-heavy) with marketing and auth surfaces. The center of gravity is operator-facing observation: tailing logs, inspecting step output, watching state machines resolve. That bias toward density, monospace, and unambiguous status is what shapes the system.

---

## 2. Aesthetic Direction

**Direction.** Industrial / utilitarian, leaning Linear-Vercel-Resend. Function-first, data-dense, monospace as a structural element, restrained but warm. Not brutalist (we have polish, shadows, rounded corners), not playful (no bouncy curves), not editorial (this is a tool, not a magazine).

**Decoration level.** Intentional. Subtle multi-layer shadows on buttons and surfaces, light grain on focus rings, clean separators. No gradients on CTAs, no decorative icons in colored circles, no purple drop-shadows on cards.

**Mood.** A senior engineer's workbench. Calm in the chrome, loud in the data. The product gets out of the way until something needs attention, then it points clearly at what.

**Reference posture.** Vercel's app dashboard for density. Linear for status semantics and motion restraint. Resend for monospace warmth. GitHub Actions for the DAG viewer's information layout. Stripe for table conventions.

---

## 3. Typography

The CSS defines two families and a precise scale. Stick to these — both for legibility and to keep the load light.

### Font families

| Token | Stack | Use |
|---|---|---|
| `--font-display` | `Inter, sans-serif` | Everything UI. Headings, body, labels, buttons, tables. |
| `--font-code` | `Commit Mono, monospace` | Code, logs, YAML, SHAs, IDs, paths, refs, durations, JSON. |

Inter is loaded from Google Fonts with full optical sizing and italics. Commit Mono is self-hosted from Storyblok (`commitmono-400`, `commitmono-700`). Both are loaded in `index.css` at the base layer — do not override the family stacks per surface.

`html` sets OpenType features `rlig`, `calt`, `lnum` so digits are tabular by default in headings and copy. This is intentional — durations, run numbers, and metric counters should not jitter on update.

### Scale

| Token | Size | Line height | Typical use |
|---|---|---|---|
| `text-xs` | 12px | 20px | Tags, metadata, table footers, code labels |
| `text-sm` | 13px | 20px | Body in tables, log lines (with `font-code`), helper text |
| `text-md` | 14px | 24px | Default body, button labels at md, form labels |
| `text-lg` | 16px | 24px | Card headings, h3, large button labels |
| `text-xl` | 18px | 28px | Section headings, h2 |
| `text-2xl` | 24px | 32px | Page sub-headings |
| `text-3xl` | 28px | 44px | Page headings, h1 in app |
| `text-4xl` | 40px | 56px | Marketing hero secondary |
| `text-5xl` | 56px | 64px | Marketing hero primary |

### Weights

| Token | Weight |
|---|---|
| `font-weight-regular` | 400 |
| `font-weight-medium` | 500 |
| `font-weight-bold` | 700 |

Default weight is regular. Headings and emphasized labels use medium. Bold is rare — reserve it for code emphasis or alert titles.

### Components

The `Header`, `Text`, and `Code` components in `components/typography/*` enforce the scale. Use them.

```tsx
<Header variant="h1">Run #4291</Header>     // text-3xl, font-medium
<Header variant="h2">Jobs</Header>          // text-xl, font-medium
<Text size="md">14 jobs, 12 steps</Text>    // text-md
<Text size="sm">Started 4 minutes ago</Text> // text-sm
<Code variant="paragraph">git@github.com:org/repo.git#a1b2c3d</Code> // text-sm font-code
<Code variant="label">duration</Code>       // text-xs font-code
```

Do not bypass these components by inlining `text-3xl font-medium` — that scatters typography decisions across the codebase.

---

## 4. Color

The system has three layers. Use the highest-level token that fits the job.

### Layer 1 — Primitives

Raw color scales in `index.css`. Names: `--color-neutral-{0..1000}`, `--color-primary-{50..950}`, `--color-{red,orange,green,blue,purple}-{50..950}`, plus `--color-accent-*` (Apple-system-style accents) and `--color-alpha-{black,white}-{0..88}` for translucent overlays.

**Never reach into primitives from a component.** Always use a semantic token. If the token you need does not exist, add it — do not bypass the layer.

### Layer 2 — Semantic tokens

These map to roles. They flip between light and dark mode automatically.

**Background**
- `bg-background-neutral-base` — page/canvas
- `bg-background-neutral-background` — page background under panels (slightly different from `base`)
- `bg-background-components-base` — cards, surface chips
- `bg-background-components-hover` / `bg-background-components-pressed` — interactive surface states
- `bg-background-field-base` / `bg-background-field-hover` — inputs
- `bg-background-subtle-base` — barely-there fill (e.g., zebra rows)
- `bg-background-contrast-base` — inverted surface (popover, tooltip, modal panel)
- `bg-background-highlight-base` / `bg-background-highlight-hover` / `bg-background-highlight-interactive` — orange-tinted surfaces; reserve for selected/active brand-tied states
- `bg-background-modal-overlay` / `bg-background-backdrop-backdrop` — scrims
- `bg-background-accent-{neutral,blue,purple,success,warning,error}-{soft,base,strong}` — colored fills for non-semantic accents

**Foreground**
- `text-foreground-neutral-base` — primary text
- `text-foreground-neutral-subtle` — secondary text
- `text-foreground-neutral-muted` — tertiary, helper, metadata
- `text-foreground-neutral-disabled` — disabled state
- `text-foreground-neutral-on-color` — text on a colored fill (white in light & dark)
- `text-foreground-neutral-on-inverted` — text on a contrast surface
- `text-foreground-highlight-interactive` — orange link/CTA text
- `text-foreground-highlight-error` — error text inline

**Border**
- `border-border-neutral-base` — default 1px
- `border-border-neutral-strong` — emphasized
- `border-border-highlights-interactive` — focused/active
- `border-border-highlights-error` / `border-border-highlights-danger` — error/destructive states

**Tags** — use the dedicated `--tag-*` tokens for status pills (see §11).

### Layer 3 — Component tokens

Each interactive component (button, checkbox, etc.) has a dedicated token set: `--background-button-*`, `--shadow-button-*`, `--checkbox-*-shadow`. These tokens compose the base + hover + pressed + focus + disabled states for one component family. Do not duplicate them on a new component — extend the layer if you build something new.

### The brand color

`--color-primary-{50..950}` is Shipfox orange. Hero values:

| Token | Hex | Role |
|---|---|---|
| `--color-primary-400` | `#ff4b00` | Primary brand orange (dark-mode interactive) |
| `--color-primary-500` | `#e63e00` | Primary brand orange (light-mode interactive) |
| `--color-primary-100` | `#ffe6db` | Soft tinted backgrounds |
| `--color-primary-50` | `#fff4f0` | Faintest tint (hover on interactive surfaces) |

**Where orange appears.**
1. Focus rings (`--shadow-button-*-focus`). Always.
2. Interactive highlight surfaces (`background-highlight-*`) — selected nav item, active filter, "this is the thing right now."
3. Inline links and `text-foreground-highlight-interactive`.
4. The brand mark (logo).

**Where orange does NOT appear.**
1. The default primary button is **inverted neutral** (`background-button-inverted-default` → near-black in light, near-white in dark). It is not an orange button. This is deliberate — primary actions appear constantly in tables and modals; orange would be exhausting and would compete with status colors.
2. Status. Statuses are green/red/orange-warning/blue/neutral. Brand orange and warning orange are different scales (`--color-primary-*` vs `--color-orange-*`). Don't conflate them.
3. Decorative gradients. There are no brand gradients.

If you find yourself reaching for orange to "make it feel branded," stop. The brand expresses itself through monospace, density, restraint, and a precise focus ring. The logo handles the rest.

### Light & dark

Both themes are first-class. Light is the default for marketing and most app surfaces; dark is used in code-heavy contexts (log viewers, YAML inspectors) and respected when the user picks it. Token values flip via `.dark` selector. Component code never branches on theme — write once, both modes work.

Theme is selected by `<ThemeProvider>` (`state/theme.ts`) with values `"light" | "dark" | "system"`.

---

## 5. Spacing

**Critical convention.** `index.css` declares `--spacing: 1px`. In Tailwind v4 this means utility names equal pixels: `p-16` is 16px of padding, `h-32` is 32px tall, `gap-8` is 8px. **This is not stock Tailwind.** Stock Tailwind would make `p-4` = 16px (4 × 0.25rem). Here, `p-4` = 4px. Anyone coming from another Shipfox project or Tailwind tutorial will get this wrong on day one — flag it in code review.

### Scale

Use this set. Do not invent values between them.

| Class | px | Use |
|---|---|---|
| `*-2` | 2 | Hairline, icon nudge |
| `*-4` | 4 | Tight gap (icon + label inside a 2xs button) |
| `*-6` | 6 | Small gap (xs/sm button internals, badge padding) |
| `*-8` | 8 | Default small gap |
| `*-10` | 10 | md button x-padding |
| `*-12` | 12 | lg/xl button x-padding |
| `*-16` | 16 | Card padding (compact), form row gap |
| `*-20` | 20 | Section gap inside a card |
| `*-24` | 24 | Card padding (default) |
| `*-32` | 32 | Section gap, page section padding-y |
| `*-40` | 40 | Major section gap |
| `*-48` | 48 | Page section gap |
| `*-64` | 64 | Top of marketing hero, generous breathing |

### Density posture

Default density is **comfortable-compact** for app surfaces. Examples:
- Default button height: `h-32` (32px), x-padding `px-10`.
- Default table row height: 36–44px depending on whether avatars/logos are present.
- Default form row gap: `gap-16`.
- Default card padding: `p-24`.

Marketing surfaces breathe more (`p-48` and up). Settings and admin look more like the run viewer than the marketing page.

---

## 6. Layout

**Approach.** Hybrid. Grid-disciplined inside the app (predictable top nav + content + optional right rail). Editorial latitude only on marketing and auth.

**App shell defaults.**
- Top header: 56px tall, sticky. Holds logo, workspace crumb, project crumb (when in a project), and user menu.
- Tab strip: 40px tall, sticky directly below the nav. Always reserved (the slot renders even when no tabs apply) so navigation between workspace home and project detail does not jump.
- No persistent left nav in v1. Navigation chrome lives entirely in the top bar.
- Content: fluid, max width capped at 1120px inside the app shell (`max-w-[1120px] mx-auto px-24 py-32`), scaling to ~1440px for marketing.
- Right rail (when present, e.g., for a "details panel"): 360–420px.

**Marketing.** Single 1280px max content width. Generous vertical rhythm. Asymmetric blocks allowed.

**Border radius.** Use the radius scale, not arbitrary values.

| Token | px | Use |
|---|---|---|
| `rounded-2` | 2 | Tag/pill inner elements |
| `rounded-3` | 3 | Tooltips |
| `rounded-4` | 4 | Inputs, status pills |
| `rounded-6` | 6 | Buttons (default), small cards |
| `rounded-8` | 8 | Cards, popovers |
| `rounded-10` | 10 | Modal, sheet |
| `rounded-12` | 12 | Large card, marketing tile |
| `rounded-16` | 16 | Marketing hero card |
| `rounded-20` | 20 | Decorative |
| `rounded-24` | 24 | Decorative |
| `rounded-full` | 9999 | Avatars, dots, icon-only circular buttons |

Buttons are `rounded-6`. Status pills are `rounded-4` or `rounded-full`. Cards are `rounded-8`. Don't drift.

---

## 7. Motion

**Approach.** Minimal-functional, with one carve-out for live data.

**Easing**
- Enter: `ease-out`
- Exit: `ease-in`
- Move (state change in place): `ease-in-out`

**Duration**
- Micro (50–100ms) — hover/pressed color shifts on buttons, pills, rows
- Short (150–250ms) — popover/dropdown enter, focus ring appearance
- Medium (250–400ms) — modal/sheet enter, tab switches
- Long (400–700ms) — onboarding step transitions, confetti

**Live data carve-out.** New log lines should append without an entrance animation — animation on every log line at 50 lines/second is nausea. DAG status transitions can use a 200ms color crossfade because they're discrete events. Job count badges should `count-up` (component exists in the broader catalog) only on initial load, not on every poll.

**No scroll-driven, parallax, or decorative loop animations** in the app. The marketing surface can be more expressive but should still feel restrained — engineers smell hype from one block away.

`tw-animate-css` is loaded for transition utilities; `framer-motion` is available for stateful transitions (sheet, modal, sheet, drawer). Reach for CSS first; Framer when CSS can't hold the sequence.

---

## 8. Components

The system ships with batteries — use them. Inventory in this workspace:

`alert`, `badge`, `button`, `card`, `icon`, `input`, `label`, `loader`, `radio-group`, `skeleton`, `theme`, `toast`, `tooltip`, `typography`.

The broader `@shipfox/react-ui` catalog adds: `avatar`, `button-group`, `calendar`, `checkbox`, `code-block`, `combobox`, `command`, `confetti`, `count-up`, `dashboard`, `date-picker`, `date-range-picker`, `dot-grid`, `dropdown-menu`, `dynamic-item`, `empty-state`, `form`, `inline-tips`, `interval-selector`, `item`, `kbd`, `modal`, `moving-border`, `popover`, `scroll-area`, `search`, `select`, `sheet`, `shiny-text`, `shipql-editor`, `slider`, `switch`, `table`, `tabs`, `textarea`. When a surface needs one of these, copy it over from the broader catalog rather than rebuilding.

### Buttons (the one most people get wrong)

| Variant | Visual | When |
|---|---|---|
| `primary` | Inverted neutral fill (near-black light, near-white dark) | The dominant action in a form, modal, page header |
| `secondary` | Neutral surface, soft shadow, subtle border | Secondary actions next to primary, toolbar buttons |
| `danger` | Red fill | Destructive: delete, revoke, force-fail, cancel run |
| `success` | Green fill | Rare. Use for explicit confirmation actions ("Approve and run") |
| `transparent` | No fill, hover gets subtle wash | Inline icon buttons, table row actions, nav items |
| `transparentMuted` | Like transparent but muted text | Lower-priority inline actions |

Sizes: `2xs` (20px), `xs` (24px), `sm` (28px), `md` (32px), `lg` (36px), `xl` (40px). Default is `md`. Run-viewer toolbars and tables tend to use `sm`. Marketing CTAs use `lg`.

**Anti-patterns.** No orange-filled primary buttons. No icon-only buttons without `aria-label`. No buttons inside table cells without a `transparent`/`transparentMuted` variant — full primary buttons in rows scream.

### Form components

Inputs are `h-32` by default, with `--shadow-border-base` border treatment, `text-md` body. Labels use `Text size="sm"` + `font-medium`. Helper text is `Text size="xs"` muted. Error text is `text-foreground-highlight-error` at `text-xs`.

### Icons

`Icon` wraps Remix Icon + Lucide + custom Shipfox marks. Names live in `components/icon/icon.tsx`. Sizing is via tailwind `size-*` (e.g., `size-16` = 16px). Default sizes mirror the button size map (16 at sm/xs, 20 at md/lg/xl).

Use `lucide-react` for stylistically-warm icons in marketing, `@remixicon/react` for app utility icons. Don't mix two visual styles in the same surface.

### Loader

`ShipfoxLoader` is the brand spinner. Use it for page-level loads and meaningful blocking states. Use the lightweight spinner icon (`Icon name="spinner"`) inside buttons and small inline spots.

### Top-nav layout components

The app shell ships in `@shipfox/client-app-shell`. Workspace switcher lives in `@shipfox/client-auth`; project switcher lives in `@shipfox/client-projects`. Each nav element below has fixed dimensions and tokens:

| Component | Dimensions | Tokens / treatment |
|---|---|---|
| `NavBar` | `h-56`, `sticky top-0 z-30`, `px-16 gap-12 flex items-center` | `bg-background-subtle-base`, `border-b border-border-neutral-base` |
| `Logo` | `h-24` (wordmark), `h-20` (mark) | Uses `useResolvedTheme()` to pick light vs dark wordmark; multi-color SVG so `currentColor` does not apply |
| `WorkspaceCrumb` / `ProjectCrumb` | name link `px-6 py-4 rounded-6`, chevron trigger `size-24 rounded-4 ml-2` | hover `bg-background-components-hover`; active link gets `aria-current="page"`; chevron uses `aria-haspopup="listbox"` + `aria-expanded` |
| `WorkspaceSwitcher` / `ProjectSwitcher` | popover `w-[280px]` / `w-[320px]` | Built on `Command` + `Popover`; always shows a separator + "+ Create" item pinned at the bottom (sibling of the scrolling `CommandList`, with `forceMount` so it stays visible under search) |
| `UserMenu` | trigger 28px circular avatar | `Avatar size="sm" content="letters"`; dropdown items: theme switcher (`light` / `dark` / `system`) + `Logout` |
| `ProjectTabs` | `h-40`, `sticky top-56 z-20`, `px-16 gap-12` | Always rendered (height reserved). Active tab: `border-b-2 border-border-highlights-interactive`. Indicator slide respects `prefers-reduced-motion` via `useReducedMotion()` |
| `Footer` | `h-40`, `px-16 flex justify-between` | `border-t border-border-neutral-base`, `text-xs text-foreground-neutral-muted`. Left: Docs / Support. Right: empty in v1 (no status badge — see §13). |

Auth and onboarding screens render under `LimitedLayout` (bare `<Outlet />`); they keep their existing centered-card layouts and do not get nav chrome.

---

## 9. Status taxonomy

This is the most-product-shaped section. Get the colors and labels wrong and the UI lies to operators.

### Run / Job / Step states

| State | Tag color | Pill text | Meaning |
|---|---|---|---|
| `pending` | neutral | "Pending" | Created, not yet eligible (deps unmet) |
| `queued` | neutral | "Queued" | Eligible, waiting for runner capacity |
| `running` | blue | "Running" | Actively executing |
| `awaiting-runner` | warning (orange) | "Awaiting runner" | Queued > N seconds; flag operator attention |
| `awaiting-manual` | warning (orange) | "Manual" | Manual gate — needs `playManualJob` |
| `delayed` | neutral | "Delayed" | `when: delayed` timer |
| `succeeded` | success (green) | "Succeeded" | Terminal, all good |
| `failed` | error (red) | "Failed" | Terminal, step or job failure |
| `cancelled` | neutral, dim | "Cancelled" | Terminal, user-initiated cancel |
| `runner-disappeared` | error (red) | "Runner lost" | Terminal, heartbeat timeout |
| `timed-out` | error (red) | "Timed out" | Terminal, duration exceeded |

Use the `--tag-{neutral,blue,success,warning,error,purple}-*` token families. Light backgrounds (`tag-*-bg`), bordered (`tag-*-border`), with text token `tag-*-text` and an optional leading icon token `tag-*-icon`.

`purple` is reserved for non-status taxonomy (e.g., environment labels, tier markers, "internal" / "experimental" badges). Don't expand it into running-state semantics.

### Trigger / delivery / artifact states

Webhook deliveries and trigger events have their own state surface. Use the same tag taxonomy:

- Trigger event: `received` (neutral) → `routed` (blue) → `discarded` (neutral) / `failed` (error)
- Webhook delivery: `pending` (neutral) → `delivering` (blue) → `succeeded` (success) / `failed` (error) / `disabled` (neutral, with warning icon)

---

## 10. Design patterns

System-level patterns. These describe *how* the design system is meant to be applied — what to reach for, what to avoid. Page-specific designs live with their features.

### Status display

Run/job/step state uses an **icon-in-circle status glyph** so the *shape* names the state, not color alone (WCAG 1.4.1: color is never the only channel). Three ways to express state, picked by context:

- **Status glyph** for run/job/step state in a dense node or row: a circular glyph in the saturated `--tag-*-icon` tone, leading the row/node. A dotted ring (pending); check, X, and slash discs (succeeded, failed, cancelled, the last dimmed); and a filled disc with an external pulsing ripple halo for the live running state (one motion treatment, no spinner; the halo is `motion-safe:` and degrades to a static disc under reduced motion). All glyphs render at one shared optical diameter. Built in `client-workflows` as `WorkflowStatusIcon`, composing the shared `Icon`/`Dot` primitives.
- **Dot** (6px circle) for pure presence/density affordances where color alone carries enough meaning. Not for job state.
- **Pill** (`rounded-4` or `rounded-full`, `text-xs`, `Badge` with a flat `iconLeft`) when state is the headline of a card or section header. The pill carries its own leading icon; don't nest a `WorkflowStatusIcon` glyph or a `Dot` inside it. A circular glyph plus the pill's own border is too many surfaces in a small space.

Color always comes from the `--tag-*` family, never from raw color primitives. The glyph or pill is sufficient on its own. Don't also tint the row/card background to match; that turns a status surface into a circus and fights dark mode.

### Code, data, and identifiers

`font-code` (Commit Mono) is structural, not decorative. Reach for it whenever the content is something the user types, copies, or pattern-matches against:

- Source code, YAML, JSON
- Logs and command output
- SHAs, IDs, paths, refs, URLs
- Durations, byte counts, sequence numbers, line numbers
- Capability tokens, environment names, tag/label values

Body text in `font-display`. Numbers inside body text rendered as content (e.g., "14 jobs failed") in display; numbers presented as data (durations, counters, line numbers) in code. Both fonts have tabular numerals enabled by default at the `html` level so columns of figures don't jitter.

### Density posture

Default to comfortable-compact. The system's defaults already encode this — `h-32` buttons, `gap-16` form rows, `p-24` card padding, 36–44px table rows. When in doubt, take the denser of two reasonable options for app surfaces and the more spacious one for marketing.

A surface is at the wrong density when:
- A table needs horizontal scroll because cells have too much padding.
- An app page has more whitespace than content above the fold.
- A marketing page feels like a settings panel.

### Live and frequently-updating data

Data that changes more than once a second should not animate on update. New log lines, polling status changes, counter ticks — all of these append or swap silently. Animation here causes nausea and obscures the change.

Discrete events (a job transitions from `running` to `succeeded`, a panel slides in) get short, ease-out transitions in the 150–250ms range. Reserve the running-state pulsing ring for the indicator dot itself, not the surrounding card.

### Tables

Tables show up everywhere. The system expects:
- Sticky header.
- Hairline borders between rows (`border-border-neutral-base`), not zebra fills.
- Right-aligned numeric columns with tabular nums.
- Row hover surfaces (`bg-background-components-hover`).
- Inline row actions in `transparent` or `transparentMuted` button variants, revealed on hover, not always visible.

### Code, log, and config blocks

When showing multi-line code/log/YAML content:
- Always `font-code`, `text-sm`, on a contrast surface (`bg-background-contrast-base`) regardless of theme — code reads better on near-black even in light mode.
- Default to no-wrap with horizontal scroll. Engineers will reach for "soft wrap" if they want it.
- Show line numbers in `text-foreground-neutral-muted`.
- Inline validation errors get an `Alert` above the block with file + line; don't rely on color alone.

### Empty states

Use the `empty-state` component pattern. Anatomy: small muted icon, `Header variant="h3"`, one-line `Text size="sm"` muted subtext, one primary CTA. Tell the user what is missing and the next action. No illustrations of cartoon rockets. No "Oops!" copy. No decorative blobs.

### Marketing surfaces

Marketing breathes more — `text-5xl` headlines, `text-xl` body, `gap-64` section gaps, full-bleed background panels in `bg-background-neutral-background`. The brand allows itself slightly more orange (link underlines, accent dot in the wordmark) but the same restraint applies: no gradients on CTAs, no decorative blobs, no centered-everything hero with three icon-in-circle features.

---

## 11. Tag colors reference

Tags / pills have their own token family because they need distinct background + border + text + icon tokens that flip cleanly in dark mode. Use these tokens directly via the `Badge` component variants — don't fabricate custom colored pills.

| Family | bg | bg hover | border | text | icon | Use |
|---|---|---|---|---|---|---|
| neutral | `tag-neutral-bg` | `tag-neutral-bg-hover` | `tag-neutral-border` | `tag-neutral-text` | `tag-neutral-icon` | Default, terminal-not-success, queued |
| blue | `tag-blue-bg` | `tag-blue-bg-hover` | `tag-blue-border` | `tag-blue-text` | `tag-blue-icon` | In-progress (running) |
| success | `tag-success-bg` | `tag-success-bg-hover` | `tag-success-border` | `tag-success-text` | `tag-success-icon` | Succeeded |
| warning | `tag-warning-bg` | `tag-warning-bg-hover` | `tag-warning-border` | `tag-warning-text` | `tag-warning-icon` | Manual gate, awaiting-runner, attention |
| error | `tag-error-bg` | `tag-error-bg-hover` | `tag-error-border` | `tag-error-text` | `tag-error-icon` | Failed, runner-lost, timed-out |
| purple | `tag-purple-bg` | `tag-purple-bg-hover` | `tag-purple-border` | `tag-purple-text` | `tag-purple-icon` | Source/environment/tier metadata only |

---

## 12. Accessibility

- Color contrast: text on background combinations are tuned for WCAG AA. Verify before introducing new tokens.
- Focus visibility: every interactive element has a `--shadow-*-focus` ring using primary orange. Do not strip `outline` without providing the ring.
- Keyboard: all actions reachable. Surfaces with list-shaped content (tables, DAGs, log entries) should support `j`/`k` traversal and `?` for a shortcuts cheatsheet.
- Motion: respect `prefers-reduced-motion`. Disable pulsing indicators and tab transitions when the user has it set.
- ARIA: icon-only buttons require `aria-label`. Live-updating regions (logs, toasts) use `aria-live="polite"`.

---

## 13. Anti-patterns (catch these in review)

1. **Orange-filled primary buttons.** Primary is inverted neutral. Orange is the focus ring and the link.
2. **Hardcoded hex values.** All color references go through tokens. If you find a `#RRGGBB` outside `index.css`, push it into a token.
3. **Tailwind unit confusion.** `p-4` is 4px, not 16px. Reviewers should flag any mismatch where the author clearly expected stock Tailwind.
4. **Decorative gradients on CTAs.** Buttons are flat with token-driven shadow stacks. If a designer mocks a purple-to-pink gradient button, push back.
5. **Status colors on backgrounds of cards/rows.** Status lives in dots, pills, and borders — not in entire row fills (which fight zebra patterns and dark mode).
6. **Mixing icon styles.** Don't put a Lucide icon next to a Remix icon in the same toolbar. Pick one set per surface.
7. **Animating high-frequency append-only data.** New log lines, polling counters, status ticks should swap silently. Reserve transitions for discrete events.
8. **Bypassing the typography components.** No raw `<h1 class="text-3xl font-medium">`. Use `<Header variant="h1">`.
9. **3-column feature grids with icons in colored circles.** Marketing surfaces stay restrained.
10. **Custom drop-shadow values.** Use the `--shadow-*` tokens. Custom shadows break dark mode.

---

## 14. Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-05 | Initial DESIGN.md drafted | Documents the existing token-driven system in `libs/shared/react/ui`. Scope is the design system itself plus reusable patterns (status display, code/data, tables, live data, empty states) — not page-level designs, which live with their features. |
| 2026-05-05 | Brand orange is interactive/focus-only, not the primary CTA fill | Status colors and primary actions both compete for attention — using inverted neutral as the primary CTA reserves orange for "where you are right now" semantics. |
| 2026-05-05 | Tabular nums on by default | Run viewers, log line numbers, durations, and counts must not jitter on update. |
| 2026-05-05 | Inter for UI, Commit Mono for code | Inter is the dev-tools default for legibility at 13–14px; Commit Mono carries warmth for the heavy log/YAML/SHA surfaces. |
| 2026-05-05 | Spacing base = 1px (Tailwind class names == pixels) | Already in `index.css`; documented here because it diverges from stock Tailwind. |
| 2026-05-05 | Added `radio-group` component (radix wrappers) | Required for accessible single-select pickers in workspace setup (connection picker, repository picker). Hand-rolled keyboard nav was rejected; radix ships tested arrow-key + Home/End + focus management. |
| 2026-05-07 | Top-nav-only app shell (no left rail) | Mirrors Vercel/Linear; defers left-rail real estate until secondary navigation demand is real. Tab strip beneath nav covers per-project sub-page navigation. Workspace and project crumbs in the top nav have split affordances: name links to entity home, chevron opens picker. |
| 2026-05-07 | Footer ships without a status badge | Hardcoded green status pill would lie about state (anti-pattern §13). Real status feed deferred until status tooling exists. Footer carries only Docs and Support links. |
| 2026-05-07 | Added UI primitives: `tabs`, `dropdown-menu`, `avatar`, `popover`, `combobox`, `command`, `sheet`, `kbd`, `scroll-area`, `logo` | Top-nav layout requires switcher (Combobox over Popover+Command), user menu (DropdownMenu), avatar, theme-aware Logo, and mobile collapse (Sheet). Ported from the broader catalog; `--copy-files` flag added to the SWC build script so SVG assets land in `dist/`. |
| 2026-06-22 | Log disclosure trigger uses an inset orange focus ring instead of the `--shadow-button-neutral-focus` token (divergence from anti-pattern §13.10) | The trigger sits inside `LogRowFrame`'s `overflow-hidden` body, which crops the standard outset ring top and bottom. An inset box-shadow is never clipped by the ancestor. `!important` is required because `tailwind-merge` cannot strip the base token (it classes the custom `shadow-*` as a shadow color, not a box-shadow). The ring keeps `--color-primary-500`, which is theme-invariant, so the focus affordance and dark mode are unaffected. |
| 2026-06-23 | Job/run/step state uses icon-in-circle status glyphs (`WorkflowStatusIcon` in client-workflows) in dense node/row surfaces, not a color-only `Dot` | The muted dark `--tag-*-text` palette rendered `pending` and `cancelled` as identical dots and leaned on color alone (WCAG 1.4.1). A shape per state plus the saturated `--tag-*-icon` tone fixes both; running keeps the existing ripple halo (no spinner). The glyph map and component live in the feature package, composing shared `Icon`/`Dot`, so the design system stays generic (no new react-ui export). The run-header pill keeps its `Badge` with a flat `iconLeft`; no glyph or dot is nested inside a pill (too many surfaces). |
