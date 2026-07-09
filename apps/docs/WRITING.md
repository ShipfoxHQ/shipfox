# Docs writing guide

Rules for every page under `content/docs/`. They keep the docs easy to read,
easy to maintain, and safe for AI agents that ingest them as Markdown.

## Page types

Each page belongs to one type. Do not mix types on one page.

| Type | Sections | Job |
| --- | --- | --- |
| Explanation | `concepts/` | What a thing is, why it exists, how it behaves. |
| How-to | `guides/`, `installation/` | Steps to reach a goal, with runnable commands. |
| Reference | `reference/` | Exact facts: fields, values, env vars, limits. |
| Operations | `operations/`, `installation/` | Run the platform: runners, provisioners, deploys. |

Usage pages (concepts, guides, reference, integrations) assume a fully set-up
environment: a workspace exists and runners are online. Content about deploying
or scaling runners belongs in the Operate section, never in usage pages.

### One canonical home per fact

Every fact lives on exactly one page: field tables and accepted values in
`reference/workflow-schema.mdx`, provider IDs in `reference/model-providers.mdx`,
numbers and defaults in `reference/limits.mdx`, env vars in the matching
reference page. Every other page links to the canonical home instead of
repeating the fact. If you copy a table, you created a future bug.

### What a concept page may contain

- Definitions, mechanics, and behavior tables (for example, gate outcomes).
- ONE minimal annotated YAML example per sub-topic.
- At most one roadmap callout.

### What a concept page must NOT contain

- Field-by-field schema tables or env-var tables (link to reference).
- Lists of accepted values (link to reference).
- Dashboard click-walkthroughs or deploy commands (link to installation).
- A limit number without a link to `reference/limits`.

## Concept page template

1. **Definition.** One to three short paragraphs, no heading. Bold the term.
   A reader who stops here knows what the thing is and why it exists.
2. `## How it works` — lifecycle, rules, evaluation semantics. Steps,
   diagrams, and Tabs are welcome.
3. One minimal annotated YAML example. Not field-exhaustive.
4. Optional: one roadmap callout.
5. `## Related pages` — Cards: the reference page first, then the most
   relevant guide, then adjacent concepts.

For unreleased features (`status: "soon"` in frontmatter): open with a warning
callout, mark examples as illustrative, and keep the field table on the page.
The table moves to the schema reference when the feature ships.

## Schema fields: document only shipped surface

Document a schema field only when its feature works end to end on `main`.
A field that parses but does nothing stays undocumented. When in doubt, check
the feature's spec and Linear project before adding it. The Zod schema
(`libs/shared/workflow/document`) is the source of truth for field shapes,
not for docs visibility.

## Example rules

- Steps referenced by `restart_from` use `key:`. Never use step-level `name:`
  in examples — `key` is the canonical identifier.
- Gate syntax is `gate.success` with `step.exit_code`, and
  `gate.on_failure.{restart_from, feedback}`.
- Examples never enumerate accepted values; the reference page does.
- Placeholder connection slugs must look like placeholders (`github_acme`) and
  sit next to a pointer to where the reader finds their real slug.
- Every example must be paste-runnable in a fresh workspace, or carry a
  comment saying what to replace.
- "Workflow" is the product term. Do not write "pipeline" except when quoting.

## Style

- Lists over prose connectives. Tables for conditions and properties.
- Generous headings: they create anchors for linking and skimming.
- Bold the key point of a paragraph; most readers skim.
- Prefer code with comments over long prose explanations.
- Diagrams for architecture; the `public/img/diagrams/*.mmd` + rendered `.png`
  pattern. Reference the PNG only after it is rendered.
- Use the `Steps` component so each step gets a meaningful heading.
- Link a name the first time it appears on a page.
- Cut filler: "you can", "please", "you may try", "simply".
- Put the subject first in a sentence. Keep paragraphs under ~5 lines.
- Never write "first... then..." chains; readers read top to bottom.
- Define acronyms on first use; the glossary holds the canonical definitions.
- Prefer generated content over hand-maintained tables
  (`scripts/generate.mjs` regions, checked by `turbo test`).
- Put expert or debugging detail in `Accordions`, not inline.

## Language level

- One idea per sentence. Split any sentence with two comma-joined clauses.
- Plain words: "uses" not "leverages", "checks" not "validates".
- Active voice, present tense.
- No marketing adjectives ("powerful", "seamless", "robust").
- Say "you" only when instructing.

Check prose pages (concepts, guides, getting-started, index) with:

```sh
node ../../.agents/skills/readme-writer/scripts/readability.mjs <page.mdx>
```

Targets: Flesch-Kincaid grade <= 9, top-1000 vocabulary >= 60%. Reference
pages are exempt from the vocabulary floor (field names skew the count).
Treat the output as guidance, not a gate — keep domain terms like CEL,
idempotent, or Drizzle when they carry meaning.

## Frontmatter

- `title` — long, SEO-facing; becomes the H1.
- `sidebarTitle` — short sidebar label.
- `status: "soon"` — renders the sidebar badge for unreleased features.
- `description` — one or two sentences; shows in search and social cards.
