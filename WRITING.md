# Writing guide

Rules for every piece of technical writing in this repository: docs pages
(`apps/docs/content/`), package READMEs, and any long-form guide or runbook.
They keep our writing easy to read, easy to skim, and clear for readers whose
first language is not English.

Surface-specific rules build on top of this guide:

- Docs app pages: [apps/docs/WRITING.md](apps/docs/WRITING.md)
  (page types, templates, schema rules).
- Package READMEs: the `readme-writer` skill
  (`.agents/skills/readme-writer/SKILL.md`) defines the required structure.
- Code comments: see the "Code comments" section of [CLAUDE.md](CLAUDE.md).

## Structure for skimming

Most readers skim. Write so a skimmer still gets the point.

- Use lists to express key points instead of long connected prose.
- Use tables for conditions, properties, and anything with repeated shape.
- Use generous headings. Each heading is an anchor someone can link to.
- Bold the key point of a paragraph.
- Prefer code with comments over long prose explanations.
- Link a name the first time it appears on a page.
- Put expert or debugging detail in collapsible sections, not inline.

## Sentences

- One idea per sentence. Split any sentence with two comma-joined clauses.
- Put the subject first. "The runner polls the API" reads faster than
  "Polling of the API is done by the runner."
- Keep paragraphs under about 5 lines.
- Active voice, present tense.
- Never chain steps with "first... then...". Readers read top to bottom;
  use a list or numbered steps instead.

## Words

- Plain words over clever words: "uses" not "leverages", "checks" not
  "validates", "sends" not "dispatches". Keep project nouns (Drizzle,
  Temporal, CEL) as they are.
- Cut filler: "you can", "please", "you may try", "simply", "just".
- No marketing adjectives: "powerful", "seamless", "robust", "battle-tested".
- Say "you" only when instructing. Everything else reads as description.
- Define acronyms on first use.

## Punctuation

**No em dashes (`—`), ever.** This is a strict rule for all produced content:
docs, READMEs, commit messages, PR descriptions. Replace an em dash with
whichever of these fits:

| Instead of | Use |
| --- | --- |
| `the value — shown once — expires` | parentheses: `the value (shown once) expires` |
| `labels route jobs — see Runners` | a semicolon or parenthesis: `labels route jobs; see Runners` |
| `one rule matters — cardinality` | a colon: `one rule matters: cardinality` |
| `the agent edits — the gate loops` | two sentences: `The agent edits. The gate loops.` |

Regular hyphens in compound words (`single-job`, `read-only`) are fine.

## Language level

Write for a competent reader whose English may be a second language.

Check any prose-heavy file with the readability script, from the repo root:

```sh
node .agents/skills/readme-writer/scripts/readability.mjs <path/to/file.md>
```

Targets: Flesch-Kincaid grade <= 9 and top-1000 vocabulary coverage >= 60%.
Treat the output as guidance, not a gate:

- The grade signal is the one to chase. A high grade almost always means one
  sentence is trying to say three things; split it.
- Domain terms (workflow, provisioner, idempotent, repository) inflate both
  numbers. Keep them when they carry meaning; hunt only for words like
  "utilize", "facilitate", or "subsequent" that add nothing.
- Reference material (field tables, env-var lists) is exempt from the
  vocabulary floor; field names skew the count.
