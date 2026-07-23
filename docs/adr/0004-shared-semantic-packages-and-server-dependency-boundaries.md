# Architecture decision record 0004: Shared semantic packages and server dependency boundaries

- **Status:** Accepted.
- **Date:** 2026-07-22.
- **Decision owners:** Server architecture.
- **Amends:** [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md).

## Context

**ADR 0002 defines calls between application programming interface (API) bounded contexts.**
Producer-owned data transfer object (DTO) packages define synchronous contracts. The application
root creates clients and injects them into consumers.

**The package boundary still has gaps.** A pure function can encode business policy that belongs to
one context. Moving that function into a DTO package or a package named `utils` does not make the
policy shared. It hides the owner while keeping the semantic dependency.

**DTO packages can become implementation surfaces.** Some DTO roots export catalog lookups,
configuration types, or other executable decisions. A consumer can call that code without importing
the producer implementation. Import checks see an allowed DTO dependency even though business logic
still crosses the boundary.

**Source checks do not cover the full package graph.** A stale dependency can remain in
`package.json` after its imports disappear. Tests and global setup can also import peer
implementations when production checks cover only `src/`.

**A broad shared directory would create another escape path.** `libs/api/shared` or one utility
package per context would make ownership harder to see. A package needs a clear concept and an
explicit architecture class. Its path or name cannot grant an exception.

## Decision

**Shipfox targets implementation decoupling.** Bounded contexts can have semantic dependencies.
Those dependencies cross an explicit DTO, event, inter-module, Temporal, or shared semantic
boundary. They never cross through a peer implementation package.

**Shared code needs shared ownership.** Purity is required for shared semantic packages, but purity
alone is not enough. The vocabulary and behavior must belong to more than one context. Producer-owned
policy stays with its producer even when the implementation is deterministic and has no side effects.

**Every server package has one architecture class.** The registry records implementations, DTO
contracts, shared packages, same-context service provider interfaces (SPIs), and composition roots.
Checks reject missing or conflicting classes.

**Tests follow the same dependency boundary as production.** A consumer test uses DTO fixtures or a
fake inter-module presentation. A test that needs several real contexts belongs at the application
or end-to-end (E2E) layer.

## Package taxonomy

**The existing `libs/shared` tree holds shared packages.** Shipfox does not add a general
`libs/api/shared` directory. API-only infrastructure remains in a named and classified package.

| Package class | Normal location | Purpose |
| --- | --- | --- |
| Shared runtime-neutral concept | `libs/shared/common/<concept>` | Small deterministic primitives with no runtime assumption. |
| Shared product language | `libs/shared/<domain>/<concept>` | Types, schemas, and rules that several contexts jointly own. |
| Shared Node infrastructure | `libs/shared/node/<concept>` | Context-neutral database, HTTP, tracing, module, and process support. |
| Bounded-context DTO | `libs/api/<context>-dto` | Wire data, events, and producer-owned inter-module contracts. |
| Bounded-context implementation | `libs/api/<context>` | Domain rules, state, persistence, configuration, and presentations. |
| Composition root | `libs/api/server` | Application graph construction and explicit deployment policy. |

**Paths do not classify packages on their own.** `libs/shared/common` contains both semantic helpers
and infrastructure such as configuration loading. The architecture registry classifies each package
by its actual role.

**Package names describe concepts.** Names such as `runner-labels`, `workflow-document`, and
`expression` show what the package owns. Names such as `utils`, `helpers`, `api-common`, and
`agent-utils` do not provide enough ownership information for a new shared package.

## Shared semantic package rules

**A shared semantic package passes every admission rule.** It must:

- Represent one named concept.
- Have semantics that at least two bounded contexts jointly own.
- Produce the same output for the same explicit input.
- Perform no network, database, file system, or process input and output.
- Read no environment variable, clock, random source, or mutable global state.
- Contain no authorization, persistence, orchestration, or provider software development kit logic.
- Depend on no bounded-context implementation package.
- Expose a small public API with a named compatibility owner.

**Business vocabulary is evidence of ownership.** A helper that decides which Agent provider is
supported belongs to Agent. A helper that checks the shared runner-label syntax can belong to
`@shipfox/runner-labels`.

**Consumer count does not create shared ownership.** Several callers can need the same producer
decision. That case needs an inter-module operation or a producer snapshot, not a shared utility.

## DTO policy

**A DTO root carries passive contract data.** It can export:

- Zod schemas and inferred types.
- HTTP request and response shapes.
- Event names and payload shapes.
- Protocol constants.
- Versioned encoding, decoding, and stored-data compatibility functions.

**A DTO root does not carry producer policy.** It cannot export:

- Catalog lookup services or availability decisions.
- Authorization or ownership decisions.
- Deployment configuration types or environment parsers.
- Persistence rows, transactions, or database helpers.
- Provider objects or software development kit types.
- Module factories, presentations, or mutable registration.

**A synchronous contract has one public location.** The producer exports it through
`<producer-dto>/inter-module`. The DTO package root does not re-export the contract, client type, or
known-error definitions.

**Contract helpers stay narrow.** A versioned serializer can check and copy a wire value. It cannot
select a provider, grant access, read configuration, or decide a feature policy.

## Dependency matrix

**The importer and target classes decide whether an import is valid.** Type-only and dynamic imports
follow the same rules as value imports.

| Importer | Own or same-context implementation | Foreign DTO or event | Foreign `/inter-module` | Shared semantic package | Shared infrastructure | Foreign implementation |
| --- | --- | --- | --- | --- | --- | --- |
| Bounded-context implementation | Allowed. | Allowed within the DTO policy. | Allowed. | Allowed when registered. | Allowed when context-neutral. | Forbidden. |
| Bounded-context DTO | Forbidden. | Allowed when required by the wire shape. | Forbidden. | Allowed when registered and contract-safe. | Only contract foundations such as Zod and `@shipfox/inter-module`. | Forbidden. |
| Consumer unit test | Allowed for its owner. | Allowed. | Allowed through a fake client or presentation. | Allowed. | Allowed. | Forbidden. |
| Composition root | Allowed for graph construction. | Allowed. | Allowed. | Allowed. | Allowed. | Allowed for wiring only. |
| Application or E2E integration test | Allowed for explicit composition. | Allowed. | Allowed. | Allowed. | Allowed. | Allowed for explicit composition. |

**The Integrations SPI remains one context.** Integration core and mapped provider packages can
import their public same-context ports and adapters. This exception does not apply to another
bounded context.

**The application root stays narrow.** It can create clients, modules, and presentations. It can
pass explicit deployment policy such as a token lifetime. It cannot become a reusable business
service or an untyped service locator.

## Choosing a boundary

**The caller's need selects the boundary.** Use this table before extracting a package:

| Need | Boundary |
| --- | --- |
| A current producer decision or state | Producer `/inter-module` operation. |
| A fact committed by a producer | DTO outbox event. |
| Retries, waits, timers, or recovery | Temporal workflow and activities. |
| A wire or stored-data shape | DTO schema and versioned serializer. |
| A context-neutral deterministic algorithm | Registered shared semantic package. |
| Business vocabulary jointly owned by several contexts | Named shared product-language package. |
| Business policy owned by one context | Producer operation or versioned producer snapshot. |

**A disputed owner is an architecture signal.** The rule may name a shared product language. The
current context split may also be wrong. A utility package must not postpone that choice.

## Worked examples

### Runner labels

**Runner-label syntax is a shared semantic concept.** Definitions, Runners, and Workflows can use
`@shipfox/runner-labels`. The package checks one stable label language and owns no runner state,
queue policy, or configuration.

### Workflow documents and expressions

**Authored workflow syntax is a shared product language.** `@shipfox/workflow-document` and
`@shipfox/expression` can define schemas and deterministic language behavior. They do not load a
workflow definition or choose whether a run can start.

### Agent validation used by Definitions

**Agent provider and harness policy stays with Agent.** Definitions must not call Agent catalog
lookups from the Agent DTO root. It must not call tool-enablement helpers there either.

Agent can expose a versioned validation-catalog operation. The result contains JSON-safe providers,
harnesses, tools, and thinking levels. Definitions loads the snapshot at its route or activity
boundary and passes the plain data into its pure normalizer.

**Shared workflow vocabulary can still move lower.** Several contexts can jointly own a harness
identifier or authored thinking value. Those values can live in the shared workflow language. Agent
deployment policy and credential rules do not move with them.

### Definition snapshots

**Versioned definition snapshot helpers remain DTO behavior.** They encode, check, and read the
stable data contract. They do not query Definitions state or choose workflow behavior.

### Auth deployment policy

**The composition root can pass an explicit token lifetime.** Logs can receive that application
policy without importing Auth configuration. Auth secrets and signing behavior remain inside Auth.

## Tests

**Consumer unit tests use contract fakes.** A fake implements the producer client type or registers a
fake presentation with an isolated transport. It does not import producer domain functions, config,
database code, module factories, or auth implementations.

**Producer presentation tests stay with the producer.** They can use the producer database and
domain errors to prove boundary translation. Callers assert only contract results and known errors.

**Cross-context behavior moves to a composition layer.** A test that needs several real modules
belongs in `@shipfox/api-server` integration coverage or an E2E suite. Package global setup cannot
import peer modules only to run their migrations.

**Test support follows the same ownership rule.** Reusable token or fixture support lives in a
contract-safe test kit when it is shared. It cannot require a peer implementation package at the
consumer's package boundary.

## Enforcement

**The architecture registry covers all relevant packages.** It records:

- Bounded-context implementation paths.
- DTO package paths and their owners.
- Shared semantic package paths.
- Shared infrastructure paths.
- Same-context SPI paths.
- Composition roots.

**Repository checks cover code and manifests.** They must check:

1. Production, colocated test, `test/`, and `tests/` imports.
2. Static, dynamic, re-exported, and type-only imports.
3. `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`.
4. DTO root exports and explicit `/inter-module` package exports.
5. Shared semantic package dependency closure.
6. Packed publication closure for DTO and inter-module entry points.

**Manifest checks reject unused implementation edges.** A consumer cannot keep a peer
implementation in `dependencies` after moving to a DTO client. A test-only composition dependency
belongs at the application integration layer, not in the consumer manifest.

**Contract-location checks are exact.** A package with an inter-module contract must expose
`./inter-module`. Its root must not export that module. Consumers must use the subpath.

**Tests receive no broad exception.** A blocked integration test moves to the correct layer or gets
one exact path, owner, reason, and tracking issue. A temporary exception cannot cover a package or
directory.

**Names do not grant exceptions.** A package named `utils`, `shared`, or `common` remains forbidden
until the architecture registry classifies it. The inventory check rejects unclassified packages.

**ADR 0007 owns enforcement placement and cross-repository distribution.** Use the
[architecture validation guide](../guides/architecture-validation.md) to select the tool and
verification path for a rule derived from this record.

## Migration

**The repository moves to this model in bounded steps.** The migration order is:

1. Add the package classifications and dependency-policy checks.
2. Remove stale cross-context implementation dependencies from package manifests.
3. Move Projects and Integrations contracts to explicit `/inter-module` exports.
4. Replace Definitions calls to Agent DTO policy with a producer snapshot or approved shared
   workflow vocabulary.
5. Replace consumer test imports with fakes or move the tests to an integration layer.
6. Run package, dependency, lockfile, packed-consumer, type, test, and composition checks.

**A migration does not rename a leak.** Moving a producer function from `core/` to a utility package
is incomplete if the producer still owns its words and rules.

## Consequences

**Package dependencies show the real architecture.** A context's manifest names contracts and
shared concepts instead of peer implementations. Package publication no longer pulls unrelated
implementation packages through stale edges.

**Shared packages have a higher admission cost.** Contributors must state the concept, owners, and
compatibility promise. This cost limits package sprawl and protects bounded-context ownership.

**Some pure code remains behind a client.** A local call would be smaller. The client keeps policy
ownership clear if the transport changes later.

**Tests can require more setup at the right layer.** Consumer unit tests become smaller and use
fakes. Application integration tests own real multi-context composition and database setup.

**DTO packages stay easier to reason about.** A root import provides data contracts. A visible
`/inter-module` import provides a synchronous business dependency.

## Rejected alternatives

### Add `libs/api/shared`

**A broad API shared directory does not explain ownership.** It would overlap with
`libs/shared/common`, `libs/shared/node`, DTO packages, and API infrastructure. Individually named and
classified packages keep the dependency reason visible.

### Add one utility package per context

**A producer utility package remains a producer dependency.** `agent-utils` would let callers skip
the Agent contract. It would also create another public release surface for the same context.

### Allow every pure function

**Pure business policy still has an owner.** Determinism says nothing about authorization, provider
support, feature availability, or domain compatibility. Shared ownership is the additional test.

### Allow implementation imports in tests

**Test-only imports still couple package releases and setup.** They make a consumer test depend on
peer state and config. Real cross-context coverage belongs at the composition or E2E layer.

### Ban all cross-context imports

**Contexts still need contracts and facts.** DTOs, events, inter-module clients, and shared product
languages make those dependencies explicit. Removing every import would replace typed contracts
with duplication or runtime lookup.

## Updating this decision

**A new shared package updates the architecture registry.** Its change must name the concept and
owners. It must list allowed dependencies. It must also say why an inter-module boundary does not
fit.

**A repeated exception changes the architecture.** Update this record or add a new ADR. Do that
before adding a broad allowlist, shared service locator, or second composition root.
