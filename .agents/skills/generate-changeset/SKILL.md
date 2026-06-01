---
name: generate-changeset
description: "Generate a changeset file for the current branch following Shipfox's changeset rules. Trigger when the user asks to add a changeset, document a change for release, bump versions, or when preparing a PR that touches libs/ or tools/."
allowed-tools: Read, Write, Bash, Glob, Grep
---

# Generate Changeset (Agent Path)

Agents cannot drive the interactive `pnpm exec changeset` prompt. This skill is
the non-interactive equivalent: it writes a properly-formatted
`.changeset/*.md` file directly.

See [CONTRIBUTING.md#releases--changesets](../../../CONTRIBUTING.md#releases--changesets)
for the canonical rule on **when** a changeset is required and which bump
level to pick. The skill below covers **how** to author the file.

## Process

### Step 1: Confirm a changeset is needed

```bash
git diff origin/main...HEAD --name-only
```

If the diff only touches `apps/`, `e2e/`, the workspace root, docs, or repo
config, stop and report that no changeset is needed. Otherwise continue.

### Step 2: Identify the affected packages

For each modified path under `libs/` or `tools/`, walk up to the nearest
`package.json` and read its `name` field. Build the list of unique package
names touched in the diff.

```bash
git diff origin/main...HEAD --name-only -- 'libs/**' 'tools/**' \
  | xargs -n1 dirname 2>/dev/null \
  | sort -u
```

Then for each directory, find the closest `package.json` and read its `name`.

Skip any package whose `package.json` has `"private": true` — changesets for
private packages are silently dropped at release time. In this repo, all
`libs/*` and `tools/*` packages are public, but verify rather than assume.

### Step 3: Choose the bump level

Pick based on what was implemented in the diff:

- `patch` — bug fixes, internal refactors, dependency bumps, performance work
- `minor` — new features, additive public API, new exported symbols
- `major` — breaking changes to public API, removed exports, renamed types

When in doubt between `patch` and `minor`, default to `patch`. Never silently
pick `major` — flag breaking changes to the user before writing the file.

### Step 4: Write the changeset file

Filename: `.changeset/<adjective>-<noun>-<verb>.md` (e.g.
`happy-lions-jump.md`). Generate three random words; do not reuse an existing
filename.

Content format (single package):

```markdown
---
"@shipfox/api-runners": minor
---

Adds per-organization runner concurrency limits to prevent shared-pool starvation.
```

Multiple packages:

```markdown
---
"@shipfox/api-runners": minor
"@shipfox/api-runners-dto": patch
---

Adds per-organization runner concurrency limits to prevent shared-pool starvation.
```

### Step 5: Report

Tell the user the filename, the packages and bumps included, and the summary.
Remind them to commit it alongside the code change (the skill writes the file
but does not commit).

## Style rules

1. **Present tense**: "Adds runner label validation", not "Added".
2. **One sentence, packed**: lead with the area of the product when it helps
   readability. Every word earns its place. No bracketed asides, no trailing
   notes, no second paragraph.
3. **One changeset per logical change**: if the diff bundles two unrelated
   changes, write two changesets.

## Worked example

Diff:

- Modified `libs/api/runners/src/core/limit.ts` to add a new public
  `enforceOrgLimit()` export
- Modified `libs/api/runners-dto/src/limit-dto.ts` to add the matching Zod
  schema
- Modified `apps/api/src/routes/runners.ts` to wire the route

Output (`.changeset/keen-otters-soar.md`):

```markdown
---
"@shipfox/api-runners": minor
"@shipfox/api-runners-dto": minor
---

Adds per-organization runner concurrency limits with a matching DTO schema for the new admin endpoint.
```

The `apps/api` change is not listed — apps are private and the release flow
ignores them.
