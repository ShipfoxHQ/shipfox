# Architecture decision record 0007: Cross-repository architecture validation

- **Status:** Accepted.
- **Date:** 2026-07-23.
- **Decision owners:** Architecture policy and developer tooling.
- **Related:** [ADR 0003: Client state and domain architecture](0003-client-state-and-domain-architecture.md),
  [ADR 0004: Shared semantic packages and server dependency boundaries](0004-shared-semantic-packages-and-server-dependency-boundaries.md),
  and [ADR 0005: Repository documentation architecture](0005-repository-documentation-architecture.md).

## Context

**Shipfox enforces architecture through several kinds of checks.** Biome plugins inspect local
source shape. Dependency Cruiser inspects resolved imports. Repository verifiers inspect package
classification, manifests, and exports. Tests inspect composed declarations and runtime behavior.

**One analyzer cannot represent every invariant well.** A local syntax matcher cannot decide which
package owns a route. An import graph cannot find an unused manifest dependency. A repository scan
cannot prove a race or recovery path. Putting every rule in one custom script would replace these
specialized models with a weaker parser.

**Some current verifiers reconstruct syntax with regular expressions.** This duplicates parsing
that Biome or Dependency Cruiser already performs. It also makes aliases, re-exports, dynamic
imports, imported constants, and generated package entry points harder to handle consistently.

**Architecture rules must also apply to the commercial Cloud repository.** Cloud consumes released
`@shipfox/*` packages. The source-available repository must never depend on Cloud packages or Cloud
source. Copying the rules or the source-available package registry into Cloud would create two
policy versions that can drift.

**A downstream repository sees packages, not upstream paths.** Cloud can inspect an installed
`@shipfox/api-workspaces` manifest. It cannot safely infer that package's architecture class from a
current checkout of another repository. Architecture identity must travel with the released
package.

**Policy changes and application changes ship on different schedules.** A new rule can reject
Cloud code even when Cloud did not change. Downstream repositories need a reviewed, versioned
upgrade path instead of receiving new blocking behavior implicitly.

## Decision

### Use specialized enforcement layers

**Each invariant uses the narrowest tool that has the required facts.**

| Required facts | Enforcement layer |
| --- | --- |
| Syntax and file location from one parsed file | Biome and a GritQL plugin |
| Resolved static, dynamic, re-exported, or type-only import edges | Dependency Cruiser |
| Actual feature, module, route, or registry declarations | Executable contract tests |
| Workspace package inventory, manifests, architecture classes, and exports | Architecture policy verifier |
| Runtime effects, concurrency, retries, persistence, or user journeys | Unit, integration, or end-to-end tests |

**One rule has one enforcement owner.** Another layer can test the owning tool or provide a
higher-level behavior check. It does not reimplement the same invariant with a second parser.

**Diagnostics identify the rule and the replacement boundary.** A failure names a stable rule ID,
the source and target facts, and the expected architecture. A contributor should not need to read
the validator implementation to understand the repair.

The [architecture validation guide](../guides/architecture-validation.md) owns the current
tool-selection and rule-authoring procedure.

### Share policy, not repository inventory

**Shipfox will publish `@shipfox/architecture-policy`.** The package will contain:

- The architecture-class vocabulary and fact schemas.
- Pure rules over normalized facts.
- Dependency Cruiser rule generation.
- Repository and package-manifest checks.
- Stable rule IDs, diagnostics, and policy test fixtures.
- A command-line interface for local and continuous integration use.

**Each repository owns one local architecture configuration.** It classifies local packages,
composition roots, and repository-specific extensions. It also records exact temporary exceptions.
The shared package contains no Cloud package paths or Cloud exception list.

**The source-available repository owns the shared package.** Cloud consumes a released version as a
development dependency. The source-available repository does not import Cloud code, configuration,
or policy extensions.

### Model repository direction as data

**Shared rules compare architecture facts, not repository names.** A package fact contains a realm,
class, and bounded context. The local configuration defines which realms can depend on which other
realms.

For example, Cloud can add this relation without adding a Cloud branch to the shared evaluator:

```json
{
  "realms": {
    "source-available": {
      "mayDependOn": ["source-available"]
    },
    "cloud": {
      "mayDependOn": ["source-available", "cloud"]
    }
  }
}
```

**Realm direction does not weaken package boundaries.** An allowed realm edge still passes the
package-class and bounded-context rules. A Cloud implementation cannot import a foreign Platform
implementation merely because Cloud can depend on the source-available realm.

**Platform does not need Cloud inventory.** Its local configuration declares only the realms and
packages that it can see. Cloud adds its private realm, packages, and allowed upstream relation in
its own configuration.

### Carry package identity in released manifests

**A published Shipfox package carries architecture metadata.** The installed `package.json`
contains a versioned field with the package's architecture class, context, and dependency realm.

```json
{
  "name": "@shipfox/api-workspaces",
  "shipfox": {
    "architecture": {
      "schema": 1,
      "realm": "source-available",
      "kind": "implementation",
      "context": "workspaces"
    }
  }
}
```

**Local and installed packages use the same fact model.** A repository adapter marks whether a fact
came from the workspace or an installed artifact. Policy rules use architecture identity rather
than repository paths.

**Shipfox packages that take part in policy need metadata.** A participating package with missing or
invalid metadata fails discovery. Third-party packages remain external dependencies. Their versions
and manifest shape stay under dependency policy unless an architecture rule classifies them
explicitly.

**Published metadata matches the installed version.** The package release process preserves or
adds the metadata while productionizing the manifest. Packed-consumer checks prove that the field
survives publication.

**The local registry remains the migration source of truth.** Platform can generate published
metadata from `api-contexts.cjs` while package manifests adopt the field. Cloud classifies its
private local packages in its repository configuration because they are not published.

### Normalize facts before evaluating policy

**The shared policy consumes a JSON-compatible fact document.** Adapters can collect facts with
Biome, Dependency Cruiser, workspace manifests, or executable loaders without coupling rules to
one repository layout.

| Fact | Required information |
| --- | --- |
| Package | Name, path, local or installed origin, realm, class, and bounded context |
| Import edge | Source package, target package, source file, specifier, and import kind |
| Manifest edge | Source package, target package, and dependency field |
| Export | Package, public subpath, and resolved source or declaration target |
| Composition | Declaring package, contribution owner, target owner, and explicit coordinator |

**The first evaluator remains TypeScript.** The fact document stays serializable so a later policy
engine can consume it without redesigning discovery. Shipfox does not add another policy language
until the rule set or repository set makes that cost useful.

### Version policy adoption

**Repositories pin the shared policy package.** Cloud adopts a new release through an ordinary
dependency update and runs its conformance checks in that pull request.

**A newly enabled blocking rule is a breaking policy change.** The package either releases it under
a breaking version or ships the rule disabled until each repository enables it explicitly. A
diagnostic improvement that preserves accepted and rejected inputs is not breaking.

**Rule IDs remain stable.** A renamed implementation does not rename the policy identity. A changed
invariant gets a new rule ID or an explicit migration note.

### Keep exceptions exact and local

**An exception identifies one finding.** It records the rule ID, source, target, owner, reason,
tracking issue, and removal condition or expiry. It cannot cover an entire package tree or disable a
shared rule globally.

**A repeated exception changes the architecture.** The owning architecture record must change
before the policy admits a broad new dependency class or composition path.

## Migration

**Existing checks stay active until their responsibility moves.** The migration proceeds in these
steps:

1. Document the tool-selection and rule-authoring contract.
2. Move file-local source-shape checks to Biome plugins.
3. Generate import-boundary rules from architecture classifications for Dependency Cruiser.
4. Replace source reconstruction of feature ownership with executable composition checks.
5. Extract package inventory, manifest, and export rules into the shared fact model.
6. Publish architecture metadata in packed `@shipfox/*` manifests.
7. Publish `@shipfox/architecture-policy` and adopt it in Cloud.
8. Remove a repository-specific verifier only after the shared owner checks the same inputs.

**Migration does not weaken a gate.** A rule moves with equivalent rejected and accepted fixtures.
The old check remains until the new check passes on both repositories that use the rule.

## Consequences

**Platform and Cloud use the same policy semantics.** Each repository keeps its own package list and
temporary debt. Shared rules change through a released dependency.

**Published packages become self-describing architecture nodes.** A downstream checker can reason
about the installed version without cloning or copying the source repository.

**Validation remains layered.** Contributors must choose a tool based on the facts a rule needs.
The guide and stable rule IDs make that choice explicit.

**Rule implementations become smaller.** Specialized parsers collect facts. Custom code focuses on
Shipfox concepts such as package class, context ownership, composition, and exception policy.

**Policy releases need compatibility care.** A new blocking rule can require coordinated cleanup in
more than one repository. Versioned adoption makes that work visible.

**Some repository-specific configuration remains.** Paths, private package classifications, and
temporary exceptions cannot live in a shared package without coupling the repositories.

## Rejected alternatives

### Copy the validators into Cloud

**Copied validators create independent policies.** Fixes, new package classes, and exception rules
would need coordinated edits in both repositories. Installed package versions could still disagree
with the copied upstream registry.

### Put every rule in Biome

**Biome plugins are strongest for local source shape.** They do not own resolved package graphs,
workspace inventory, installed package metadata, composed feature values, or runtime behavior.

### Build one repository scanner

**One scanner would reimplement several parsers.** It would need to understand TypeScript imports,
package resolution, JSON manifests, public exports, and executable composition. Specialized tools
already own those models.

### Adopt Nx for module boundaries

**Nx provides project tags and module-boundary rules.** Shipfox already uses Turbo, Biome, and
Dependency Cruiser. Adding another workspace graph and lint integration would duplicate current
infrastructure without solving package-version metadata by itself.

### Adopt Open Policy Agent immediately

**A policy language can evaluate normalized facts well.** It also adds a language, binary,
debugging model, and release surface. A JSON-compatible fact contract preserves this option while
TypeScript remains sufficient.

### Publish one central package catalog

**A separate catalog can drift from installed package versions.** Metadata in each package artifact
describes the version Cloud actually resolved. A catalog can remain a generated report, but it is
not the downstream source of truth.

## Updating this decision

**A new enforcement engine must own facts that existing layers cannot express well.** Update this
record before introducing a second shared policy package, a second package-class vocabulary, or a
policy service that changes the versioning model.

**A new repository adopts the shared contract through local classification.** It does not add its
paths or private exceptions to the shared package.
