# Docs writing guide

Rules specific to the docs app (`content/docs/`). They sit on top of the
repo-wide [WRITING.md](../../WRITING.md), which owns the general structure,
sentence, word, and punctuation rules (including the strict no-em-dash rule)
and the language-level targets. Read that first.

## Absolute punctuation rule

Never use the Unicode em dash (U+2014). This applies to prose, frontmatter,
examples, code comments, and generated markers. Use a comma, colon, semicolon,
parentheses, or a new sentence instead. A docs change is not complete while a
scan for U+2014 finds a match.

## Page types

Each page belongs to one type. Do not mix types on one page.

| Type | Sections | Job |
| --- | --- | --- |
| Explanation | `understand/` | What a thing is, why it exists, how it behaves. |
| How-to | `how-to/`, `installation/` | Steps to reach a goal, with runnable commands. |
| Reference | `reference/` | Exact facts: fields, values, env vars, limits. |
| Operations | `operations/`, `installation/` | Run the platform: runners, provisioners, deploys. |

Usage pages (understand, how-to, reference, integrations) assume a fully set-up
environment: a workspace exists and runners are online. Content about deploying
or scaling runners belongs in the Operate section, never in usage pages.

### One canonical home per fact

Every fact lives on exactly one page: field tables and accepted values in
`reference/workflow-schema.mdx`, provider IDs in `reference/model-providers.mdx`,
numbers and defaults in `reference/limits.mdx`, env vars in the matching
reference page. Every other page links to the canonical home instead of
repeating the fact. If you copy a table, you created a future bug.

### What an explanation page may contain

- Definitions, design rationale (the why), and comparisons to tools the
  reader already knows.
- Mechanics and behavior tables (for example, gate outcomes).
- ONE minimal annotated YAML example per sub-topic, when an example helps.
  A concept page may have none.
- A short "Common misconceptions" section correcting the surprises readers
  hit.
- At most one roadmap callout.

### What an explanation page must NOT contain

- Field-by-field schema tables or env-var tables (link to reference).
- Lists of accepted values (link to reference).
- Dashboard click-walkthroughs or deploy commands (link to installation).
- A limit number without a link to `reference/limits`.
- A `## Related pages` card grid (it duplicates the sidebar). Link names
  inline where they appear; at most one "next" Card at the end.
- Implementation vocabulary in the opening. Explanations lead with the reader's
  words (trigger, job, step, agent step, feedback loop, outputs, secrets);
  internals (execution, attempt, lease, harness) stay inside "How it works"
  subsections or the reference.

## Explanation page template

1. **Definition.** One to three short paragraphs, no heading. Bold the term.
   A reader who stops here knows what the thing is and why it exists.
2. **Why it exists.** What it replaces or the design rationale, either woven
   into the definition or as its own short section.
3. `## How it works`: mental model, lifecycle, boundaries, evaluation
   semantics. Steps, diagrams, and Tabs are welcome.
4. Optional: ONE minimal annotated YAML example. Not field-exhaustive.
5. Optional: `## Common misconceptions`.
6. Optional: one roadmap callout, and at most one "next" Card.

For unreleased features (`status: "soon"` in frontmatter): open with a warning
callout, mark examples as illustrative, and keep the field table on the page.
The table moves to the schema reference when the feature ships.

## Schema fields: document only shipped surface

Document a schema field only when its feature works end to end on `main`.
A field that parses but does nothing stays undocumented. When in doubt, check
the feature's spec and Linear project before adding it. The Zod schema
(`libs/shared/workflow/document`) is the source of truth for field shapes,
not for docs visibility.

The rule cuts both ways: docs must not lag shipped features any more than
they may lead them. A "coming soon" callout on a shipped feature makes an
evaluator conclude the product is smaller than it is. When a feature ships,
its docs update in the same slice.

Two gates keep pages honest:

- **Executable examples.** Run every YAML block on a page against a fresh
  workspace before the page merges (or mark exactly what to replace).
- **Same-slice references.** A page may not merge before the reference facts
  it links to are corrected; no slice ships a claim that another page
  contradicts.

## Example rules

- Steps referenced by `restart_from` use `key:`. Never use step-level `name:`
  in examples; `key` is the canonical identifier.
- Gate syntax is `gate.success` with `step.exit_code`, and
  `gate.on_failure.{restart_from, feedback}`.
- Examples never enumerate accepted values; the reference page does.
- Placeholder connection slugs must look like placeholders (`github_acme`) and
  sit next to a pointer to where the reader finds their real slug.
- Every example must be paste-runnable in a fresh workspace, or carry a
  comment saying what to replace.
- "Workflow" is the product term. Do not write "pipeline" except when quoting.

## Docs-app specifics

- Use the `Steps` component so each step gets a meaningful heading.
- Diagrams follow the `public/img/diagrams/*.mmd` + rendered `.png` pattern.
  Reference the PNG only after it is rendered.
- Prefer generated content over hand-maintained tables
  (`scripts/generate.mjs` regions, checked by `turbo test`).
- Put expert or debugging detail in `Accordions`, not inline.

## Language level

Check prose pages (understand, how-to, getting-started, index) with the
readability script, from the repo root:

```sh
node .agents/skills/readme-writer/scripts/readability.mjs apps/docs/content/docs/<page>.mdx
```

Targets and interpretation live in the root [WRITING.md](../../WRITING.md).
Reference pages are exempt from the vocabulary floor; field names skew the
count.

## Frontmatter

- `title`: becomes the H1. On explanation pages it is the subject name, short
  ("Agents", "Feedback loops"); the `description` carries the SEO phrasing.
  How-to, reference, and installation pages keep long, SEO-facing titles.
- `sidebarTitle`: short sidebar label. For explanation pages it must sell the
  capability when the subject name alone does not ("Listening Jobs" needs its
  index card and description to say "react to reviews and events").
- `status: "soon"`: renders the sidebar badge for unreleased features.
- `description`: one or two sentences; shows in search and social cards.
