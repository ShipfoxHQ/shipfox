---
name: readme-writer
description: "Use this skill to write or revise a README.md for a Shipfox workspace package (libs/*, tools/*). Follows the project's existing README shape, keeps prose ESL-friendly, and runs a readability check before finishing. Trigger on write a README, draft README, rewrite README, document this package, or improve the README."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# README Writer

Write the README that the Shipfox workspace already converges on: short,
scannable, code-first, and worded so a non-native English reader can use the
package without re-reading a sentence.

## When to use this skill

- A workspace package under `libs/` or `tools/` is missing a README, or its
  README has drifted from the code.
- A user asks to "write a README", "document this package", or "rewrite the
  README so it's clearer".

This skill is for **package READMEs**, not for the repo-root README, design
docs, or RFCs.

## Inputs to gather first

Before writing, read the package source so the README reflects what actually
ships. Open these in order:

1. `package.json` — public name, `exports`, `bin` entries, `scripts`,
   `dependencies`. The README's first line and install snippet come from
   `name`.
2. `src/index.ts` (or whatever `exports["."]` points at) — the symbols a
   consumer can import.
3. `src/**/*.ts` — only as needed to understand each exported symbol.
4. Any sibling `*-dto` package — DTO/event names that belong in the public
   contract section.
5. `drizzle/` or `migrations/` — table prefix and schema, if the package owns
   a database.

Do not document symbols that aren't in `exports` or `bin`. Internal helpers
stay internal.

## Required structure

Every package README follows the same shape. Use only the sections that apply
to the package, but keep them in this order:

```text
# <Display Name>            ← required
<one-line description>      ← required (1 sentence)

## What it does             ← required
## Installation / Setup     ← required
## Usage                    ← required (one runnable snippet)
## Environment              ← required when the package reads process.env
## Routes / API / Data Model ← required when the package exposes one of these
## Behavior Notes           ← optional, for non-obvious semantics
## Development              ← required
## License                  ← required
```

### Title and one-liner

The title is the human-readable name (`Shipfox Outbox`, `Shipfox React UI`)
for `@shipfox/*` runtime packages, or the literal package name (`@shipfox/biome`,
`@shipfox/typescript`) for tooling packages whose CLI name matters. Match the
convention already used by neighboring packages — do not rename one in a README
pass.

The one-liner answers "what is this for?" in one sentence. No marketing. Front
the noun phrase ("Typed outbox helpers for Shipfox modules."), then add the
when-to-reach-for-it clause if it fits in the same sentence.

### "What it does"

A bulleted list of the public surface. Each bullet starts with a `**bolded**`
symbol name or concept and is followed by one sentence:

```markdown
- **`createOutboxTable(pgTable)`**: Creates a Drizzle table named `outbox`
  for a module table namespace.
- **`DomainEvent`**: Runtime event shape used by dispatchers.
```

Group related exports under one bullet (`**Interceptor helpers**`,
`**Theme helpers**`) when listing each function would just create noise.

### Installation / Setup

For tooling packages published as devDependencies, show `pnpm add -D ...`. For
workspace-private packages, show the `workspace:*` JSON snippet (see
`libs/api/auth/README.md`). For libraries that could in theory ship publicly,
show `pnpm add` and skip the `yarn` / `npm` aliases unless an existing README
in the same folder already lists them — match the neighbor.

### Usage

Exactly one runnable code block that exercises the primary entry point. Keep
it small enough that a reader can scan it without scrolling. Use TypeScript
unless the package is JS-only. Import from the package root, not from internal
paths. If the snippet needs setup (env vars, a wrapping provider), show the
setup as a second smaller block under the same heading.

### Environment, Routes, API, Data Model

Use Markdown tables when there are more than three rows of repetitive
information, and bullets otherwise. The auth README's environment and route
tables are the reference shape:

```markdown
| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | none | Secret used to sign and verify access tokens. |
```

Data Model sections name the table prefix (`auth_`, `runners_`) and list
tables. Cryptographic details (Argon2id, opaque tokens stored as hashes) go
here, not in Usage.

### Development

The same three-line block, scoped to the package via `--filter`:

```markdown
## Development

\`\`\`sh
turbo check --filter=@shipfox/<name>
turbo type --filter=@shipfox/<name>
turbo test --filter=@shipfox/<name>
\`\`\`
```

Drop `test` if the package has no test target. Add `turbo build` only if the
package emits a build output (most `libs/shared/node/*` packages don't).

If tests need Docker services or fixtures, mention that under this section in
one sentence, then point at `docker compose up -d`.

### License

Always:

```markdown
## License

MIT
```

## Voice rules

These are what separate a Shipfox README from a generic one:

1. **One idea per sentence.** If a sentence has more than one comma-joined
   clause, split it. The audit script flags this indirectly via the
   Flesch-Kincaid grade.
2. **Plain words over clever words.** Prefer "uses" to "leverages", "checks"
   to "validates", "sends" to "dispatches". Project nouns (`Drizzle`,
   `Temporal`, `Fastify`, `Argon2id`) are not optional — keep them.
3. **Active voice, present tense.** "The module creates tables with the
   `auth_` prefix." Not "Tables will be created…".
4. **No marketing adjectives.** Drop "powerful", "robust", "seamless",
   "battle-tested". State what the package does, not how it feels.
5. **No "we" / "you" unless instructing.** Setup and Usage sections may say
   "Add scripts to your `package.json`". The rest reads as description, not
   conversation.
6. **No emoji, no badges, no ASCII art** in package READMEs. The repo-root
   README is the only place those decisions get made.

## Readability check

After writing or editing a README, run the audit script:

```sh
node .claude/skills/readme-writer/scripts/readability.mjs <path-to-README.md>
```

It reports two numbers:

- **Flesch-Kincaid grade** — target `<= 9`. The script is the same formula
  US schools use to grade textbook reading level. Higher numbers mean longer
  sentences or longer words. A README that scores 12+ almost always has one
  sentence trying to say three things; split it.
- **Top-1000 vocabulary coverage** — target `>= 60%`. The list in
  `scripts/top1000.txt` is the same one shipped by the upstream readability
  skill and is the practical floor of English an ESL reader is fluent in. The
  script lists the most frequent words *outside* the top-1000 so you can scan
  for unnecessary vocabulary. Project identifiers (`Shipfox`, `Drizzle`,
  `Fastify`, `outbox`, `temporal`) will always show up here — that's fine.
  What you're hunting is words like "leverages", "utilize", "facilitate",
  "subsequent". Replace each one with a simpler word.

The script strips fenced code blocks and inline backticks before scoring, so
code examples and `npm` package names don't drag the numbers around. It exits
non-zero when either threshold misses — useful if a future CI wants to gate
on it, but for now treat the output as guidance.

If a section legitimately needs a high-vocabulary word ("idempotent",
"deterministic"), keep it. The goal is not to dumb the docs down; it is to
remove vocabulary that adds nothing.

## Workflow

1. Read `package.json` and the public entry point.
2. Sketch the section list from the "Required structure" above, dropping the
   ones that don't apply.
3. Draft each section, top to bottom. Stop after writing one Usage snippet.
4. Run the readability script. Fix sentences flagged by the grade signal
   first, then trim words flagged by the coverage signal.
5. Re-read the file once end-to-end as if you were the user opening it from
   `pnpm view` for the first time. Cut anything you skipped.

## Reference READMEs

When in doubt, copy the shape of an existing one:

- **Minimal library** — `libs/shared/node/outbox/README.md`
- **Library with module declaration** — `libs/shared/node/module/README.md`
- **Library with env config + bin scripts** — `libs/shared/node/postgres/README.md`
- **API feature module with routes + data model** — `libs/api/auth/README.md`
- **UI component library** — `libs/shared/react/ui/README.md`
- **CLI tooling package** — `tools/biome/README.md`, `tools/typescript/README.md`

If a new package doesn't match any of these, it probably wants the
`libs/shared/node/outbox/README.md` skeleton.

## Anti-patterns to refuse

- Long preamble paragraphs before the first `## What it does` heading.
- Marketing taglines under the title.
- Documenting unexported internals.
- Inventing API surface that doesn't exist in `exports`.
- Adding a "Contributing" section — that belongs in the root `CONTRIBUTING.md`.
- Duplicating environment defaults instead of reading them from the schema.
- Replacing the Development block with a custom command set when `turbo check
  / type / test --filter=` would do.
