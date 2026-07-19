# ADR 0002: API inter-module architecture

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision owners:** API inter-module contracts
- **Decision issue:** [Define the API inter-module architecture](https://linear.app/shipfox/issue/ENG-1032/define-the-api-inter-module-architecture-and-bounded-context-policy)
- **Foundation delivery:** [Build the registered in-memory transport](https://linear.app/shipfox/issue/ENG-1033/build-the-registered-in-memory-inter-module-transport)

## Context

API bounded contexts call each other through implementation package exports today. These exports
include domain functions, entities, errors, database helpers, configuration, and callback-valued
providers. Some dependencies are passed through module factories. Others use process-global setters.

This shape makes an implementation package its own integration contract. A consumer can depend on a
producer's internal model without an explicit decision. Local calls can also pass values that would
fail across a serialized transport. Package publication then turns internal details into compatibility
obligations.

The [contract-first transport spike](https://linear.app/shipfox/issue/ENG-1031/spike-contract-first-in-memory-calls-between-triggers-and-workflows)
compared a plain TypeScript and Zod port with oRPC. It used the Triggers to Workflows boundary and
checked local and serialized behavior. It retained no prototype code.

## Decision

Shipfox uses **producer-owned inter-module APIs** for synchronous calls between API bounded contexts.
Each inter-module API has four roles:

- A **contract** defines stable method identifiers, JSON-safe Zod schemas, and known errors.
- A **client** gives a consumer a narrow typed interface for the methods it calls.
- A **presentation** maps the contract to the producer's application and domain behavior.
- A **transport** checks and serializes calls. The first production transport is in memory.

The application composition root creates the transport and clients. It passes only declared clients
to module factories. Producer modules declare their presentations. The composition root registers all
presentations and seals the transport before startup can cause side effects.

Consumers do not receive the registry or producer implementation functions. Modules do not register
through module-load side effects. The same client contract can use a future HTTP transport without a
consumer change.

Shipfox implements this architecture with plain TypeScript and Zod. Shipfox does not adopt oRPC for
this need. oRPC adds a framework, dependency, and release surface without solving a current contract
problem that the smaller design leaves open.

This ADR changes no production behavior. A follow-up implements the shared foundation. Later work
migrates one producer boundary at a time.

## Bounded contexts

A bounded context owns a business capability. It owns the capability's data, invariants, application
operations, errors, configuration, and presentation. A package is only a build and release unit. A
bounded context can contain more than one package when those packages implement one capability.

The following map is the source of truth for the API migration:

| Bounded context | Packages |
| --- | --- |
| Agent | `@shipfox/api-agent`, `@shipfox/api-agent-dto` |
| Annotations | `@shipfox/annotations`, `@shipfox/annotations-dto` |
| Auth | `@shipfox/api-auth`, `@shipfox/api-auth-dto` |
| Definitions | `@shipfox/api-definitions`, `@shipfox/api-definitions-dto` |
| Integrations | `@shipfox/api-integration-core`, all `@shipfox/api-integration-*` provider packages, and their DTO packages |
| Logs | `@shipfox/api-logs`, `@shipfox/api-logs-dto` |
| Projects | `@shipfox/api-projects`, `@shipfox/api-projects-dto` |
| Runners | `@shipfox/api-runners`, `@shipfox/api-runners-dto` |
| Secrets | `@shipfox/api-secrets`, `@shipfox/api-secrets-dto` |
| Triggers | `@shipfox/api-triggers`, `@shipfox/api-triggers-dto` |
| Workflows | `@shipfox/api-workflows`, `@shipfox/api-workflows-dto` |
| Workspaces | `@shipfox/api-workspaces`, `@shipfox/api-workspaces-dto` |

`@shipfox/api-server` is the application composition root. `@shipfox/api-dispatcher`,
`@shipfox/api-auth-context`, and `@shipfox/api-common-dto` are shared API infrastructure. They are not
business bounded contexts.

The Integrations provider packages are one explicit multi-package context. The provider registry,
provider ports, and provider-owned adapters are an internal service provider interface (SPI). A new
package split does not create another exception. The bounded-context map must change in an ADR before
Dependency Cruiser treats the packages as one context.

## Current crossing inventory

This inventory was checked on 2026-07-19 against production imports under `libs/api/**/src`, package
exports, and `libs/api/server/src/modules.ts`. The composition check matters because a root-level
function injection does not appear as a direct consumer import.

The table groups files by business crossing. It does not count DTO, outbox event, request-claim, or
shared infrastructure imports as implementation crossings.

| Producer | Consumer | Current implementation surface | Intended producer API |
| --- | --- | --- | --- |
| Secrets | Agent | Secret read, namespace read, write, delete, and domain errors | Secret and namespace operations |
| Secrets | Integrations | The composition root injects raw secret functions and provider namespace wrappers | Provider-scoped secret operations |
| Secrets | Workflows | Secret and variable reads plus a decryption domain error | Secret and variable reads |
| Workspaces | Auth | Membership listing, invitation preflight and acceptance, and domain errors | Membership and invitation operations |
| Workspaces | Integrations | GitHub, Jira, Linear, and Slack install routes import a membership database check | Active membership checks |
| Integrations | Projects | Source-control provider interface and Integrations errors | Source-control operations |
| Integrations | Definitions | Source control, catalogs, connection snapshots, connection lookup, and errors | Source-control and connection operations |
| Integrations | Workflows | Source control, checkout types, catalogs, connection data, and process-global setters | Checkout, connection, and agent-tool operations |
| Workflows | Integrations | The composition root injects `loadRunningLeasedStep` into the agent-tools gateway | Leased-step context lookup |
| Projects | Definitions | Project access function and domain error | Project access checks |
| Projects | Secrets | Project lookup and authorization function plus a domain error | Project ownership checks |
| Projects | Workflows | Project lookup and access functions plus domain errors | Project lookup and access checks |
| Auth | Runners | Runner and job token minting plus Auth configuration | Runner and job token minting |
| Auth | Workflows | Job lease token minting | Job lease token minting |
| Auth | Logs | Auth configuration import | Module-owned configuration or composition policy |
| Workflows | Triggers | Run and listener commands, Workflow entities, and domain errors | Run start and listener delivery commands |
| Workflows | Logs | Step entity lookup and a test-only global replacement | Step log context lookup |
| Definitions | Workflows | Definition lookup, mutable workflow model types, and defaults | Versioned definition snapshots |
| Runners | Workflows | Queue commands, lease checks, and runner capability helpers | Scheduling, lease, and capability operations |
| Agent | Workflows | Resolver callbacks, runtime credentials, deep implementation imports, and domain errors | Agent defaults, step materialization, and runtime credentials |
| Annotations | Workflows | Annotation mutation function, params, and domain errors | Annotation replace and remove commands |

`@shipfox/api-server` also imports each implementation module and factory. Those imports are the
composition-root exception. They are not consumer dependencies.

The delivery sequence, owners, and issue dependencies live in the
[API inter-module contracts project](https://linear.app/shipfox/project/api-inter-module-contracts-de98dd5921b5).
This ADR stays focused on the architecture so delivery splits can change without making the decision
harder to read.

## Contract ownership and naming

Each producer's existing DTO package owns its inter-module contract. The package adds an explicit
`/inter-module` export. Shipfox does not create a second `*-contract` package for the same bounded
context.

For example, Workflows owns:

```ts
import {
  workflowsInterModuleContract,
  type WorkflowsInterModuleClient,
} from '@shipfox/api-workflows-dto/inter-module';
```

Names follow these rules:

| Item | Pattern | Example |
| --- | --- | --- |
| Package export | `<producer DTO package>/inter-module` | `@shipfox/api-workflows-dto/inter-module` |
| Contract value | `<producer>InterModuleContract` | `workflowsInterModuleContract` |
| Client type | `<Producer>InterModuleClient` | `WorkflowsInterModuleClient` |
| Presentation factory | `create<Producer>InterModulePresentation` | `createWorkflowsInterModulePresentation` |
| Module identifier | Stable lowercase context name | `workflows` |
| Method identifier | Stable use-case verb phrase | `startRunFromTrigger` |

Method names describe producer use cases. They do not copy a database function name or expose a
general repository. A consumer cannot request arbitrary entities, callbacks, configuration objects,
or transactions.

The DTO package remains dependency-light. It can depend on Zod and other DTO packages. It cannot
depend on the producer implementation, Fastify, Drizzle, a transport, or OpenTelemetry. The package
root does not re-export inter-module symbols. HTTP and event imports can still use their existing DTO
exports without becoming inter-module API imports.

## Composition lifecycle

The composition root performs these operations in order:

1. Create one isolated inter-module transport for the application instance.
2. Create typed clients from contracts. A client can exist before its presentation is registered.
3. Pass each module factory only the clients that module declares.
4. Collect producer presentations from the returned `ShipfoxModule` declarations.
5. Register every presentation. Reject duplicate module or method registrations.
6. Check every declared client requirement. Reject a missing presentation or method.
7. Seal the transport. Reject later registrations and calls made before sealing.
8. Start database migration, startup tasks, workers, metrics, and HTTP listeners.

The transport foundation defines the exact API. Its declarative shape must preserve this model:

```ts
const transport = createInterModuleTransport();

const workflows = transport.createClient(workflowsInterModuleContract);
const integrations = transport.createClient(integrationsInterModuleContract);

const modules = [
  createWorkflowsModule({clients: {integrations}}),
  createIntegrationsModule({clients: {workflows}}),
];

registerInterModulePresentations({transport, modules});
transport.seal();
```

Creating clients before registration supports bidirectional context relationships. It does not
create a dependency cycle between implementation packages. Each implementation depends only on the
other producer's DTO contract.

`ShipfoxModule` declares presentations and required contracts as data. A module never receives the
transport registry. A presentation closes over producer-owned application functions when its module
factory constructs it.

No module uses a process-global setter, service locator, module-load registration, or mutable default
client. Tests and multiple application instances must be able to create isolated transports.

## Contract data

### JSON-safe values

Every input, output, and known-error detail is valid JSON:

- `null`, booleans, finite numbers, strings, arrays, and objects with string keys are allowed.
- Timestamps use documented ISO 8601 strings.
- Identifiers and decimal values use strings when number precision is not safe.
- Binary data uses a documented string encoding or a separate blob boundary.
- `undefined`, `bigint`, symbols, functions, classes, `Date`, `Map`, `Set`, streams, SDK objects,
  Fastify requests, Drizzle rows, and transaction handles are forbidden.

Zod schemas are the runtime source of truth. Exported TypeScript types are inferred from those
schemas. Object schemas parse and remove unknown fields by default. This supports additive fields
across versions without exposing unchecked data. A strict object must state why unknown fields are
unsafe, and strictness becomes part of that method's compatibility policy.

The in-memory transport serializes or performs an equivalent JSON round trip on requests, responses,
and known errors. It also parses both sides with the contract schemas. A local call cannot share a
mutable object reference with a presentation or hide a value that an HTTP transport would reject.

### Stable errors

Each method declares a closed map of known error codes to Zod detail schemas. Codes use stable
kebab-case names. A producer presentation catches its domain errors and maps only expected cases to
that map.

Clients receive a transport-owned typed known error with `code` and checked `details`. Consumers
branch on the code. They do not import or use `instanceof` with a producer domain error.

Input failures, invalid producer output, undeclared errors, and internal failures are not known
business errors. The transport returns an opaque failure with a correlation point for logs and
traces. It does not expose the original message, stack, cause, SQL, SDK response, secret, or raw DTO.
Local and serialized transports promise the same valid results and known errors. They do not promise
the same internal exception class or diagnostic text.

### Versioning

Module and method identifiers are compatibility identifiers. They do not include a package version.
An additive method gets a new stable method identifier. An additive optional field can extend an
existing method when old and new producers and consumers can safely ignore it.

A breaking input, output, or error change gets a new method identifier such as
`getDefinitionSnapshotV2`. Both identifiers remain registered during a rolling migration. The old
method is removed only after all consumers move and the owning DTO package takes the required major
release.

Adding a possible known error to an existing method is also breaking. An exhaustive consumer may not
handle the new code. Add the error through a new method or a major contract release.

Persisted or long-lived payloads include a schema version inside the DTO. A producer rejects an
unknown version as an opaque incompatibility unless the contract declares it as a known caller error.

### Tracing

The transport creates a client span and a presentation span for each call. It propagates the active
trace context through transport metadata. Trace metadata is not part of the business DTO.

Span attributes are bounded: producer module, method, transport kind, outcome, and known error code.
Inputs, outputs, secrets, tokens, error messages, and entity identifiers are not trace attributes.
The future HTTP transport must continue the same trace rather than start an unrelated root span.

### Idempotency, cancellation, and unknown outcomes

A query has no side effect. A command can change state. A command that callers or Temporal activities
may retry includes a stable idempotency key or command identifier in its business input. The producer
stores or checks that identity at the same consistency boundary as the mutation.

`AbortSignal` and future deadlines are transport options. They are not business DTO fields. A signal
can stop waiting or stop work that has not committed. It cannot promise that a concurrent or remote
mutation rolled back.

Cancellation, timeout, connection loss, and an opaque transport failure can leave a command with an
unknown outcome. A caller retries only with the same idempotency key or checks producer state through
a query. Error text must not claim that the operation failed before commit when the transport cannot
prove it.

## Choosing the boundary

Use an inter-module API when the caller needs a result before it can continue and the operation fits
inside the caller's request or Temporal activity lifetime.

Use an outbox event when:

- the producer announces a committed fact;
- consumers can react later;
- there can be multiple independent consumers; or
- the producer must commit its state and notification atomically.

The event schema lives in the producer DTO package. A consumer must not call back into the producer
only to reconstruct data that belongs in the event unless the data is large, sensitive, or expected
to change before consumption.

Use Temporal when:

- work spans retries, timers, or long waits;
- a multi-step process must survive process restarts;
- several contexts need ordered commands and recovery; or
- an operation needs durable cancellation or compensation.

A Temporal activity can use an injected inter-module client. Temporal workflow code stays
deterministic and does not receive a transport, registry, database handle, or implementation module.

No boundary permits a transaction to cross contexts. If one atomic database transaction is required
to preserve an invariant, either one producer owns the full operation or the bounded-context split is
wrong.

## Dependency policy

### Allowed dependencies

Every allowed cross-context dependency has one architectural reason:

| Dependency | Reason | Constraint |
| --- | --- | --- |
| Producer DTO package `/inter-module` export | Synchronous, transport-neutral contract | JSON-safe Zod contracts and types only |
| Producer DTO and event exports | HTTP data and committed asynchronous facts | No implementation, database, or configuration types |
| `@shipfox/node-temporal` and producer-owned Temporal names or payload DTOs | Durable orchestration boundary | No peer activity, workflow implementation, or database import |
| Pure shared utility package | Behavior has no business owner and no state | Deterministic, configuration-free, and free of domain entities and errors |
| `@shipfox/api-auth-context` | Shared HTTP presentation context derived from verified claims | Claim-only and stateless; no business database lookup |
| Integrations provider SPI | Core and provider packages implement one bounded context | Only packages listed in the Integrations context map |
| `@shipfox/api-server` composition root | Application assembly must see factories and implementations | Wiring only; no business behavior or reusable consumer API |
| Shared module, outbox, telemetry, database, and Fastify infrastructure | Platform mechanics used inside each context | Does not expose one business context to another |

The pure-utility exception is intentionally narrow. Moving a domain type or helper to a shared
package does not make the dependency valid. A utility is shared only when its behavior and vocabulary
are context-neutral.

### Forbidden dependencies

Outside the composition root, one bounded context must not import another context's:

- implementation package root;
- implementation package subpath, including `core`, `db`, `presentation`, `config`, or test helpers;
- application or persistence function;
- domain entity, error, provider object, registry, or callback-valued resolver;
- database schema, row, query helper, transaction, or migration;
- configuration schema, parsed configuration, or secret;
- `ShipfoxModule` value or module factory; or
- global setter, mutable holder, service locator, or test-only implementation replacement.

Type-only imports are still dependencies and are forbidden. Re-exporting an implementation type
through a DTO or shared package is also forbidden.

## Dependency Cruiser enforcement

The final migration adds the repository gate. The gate uses the bounded-context package map in this
ADR and applies to production and test imports in API packages.

The policy has these rules:

1. `api-no-cross-context-implementation-imports` rejects root and subpath imports from every peer
   implementation package. It rejects value, type-only, static, and dynamic imports.
2. `api-inter-module-contract-location` accepts synchronous peer contracts only from the producer DTO
   package's explicit `/inter-module` export.
3. `api-no-peer-config-imports` names configuration crossings in its diagnostic even though the first
   rule also rejects them.
4. `api-integrations-provider-spi` limits the same-context exception to the mapped Integrations core
   and provider packages.
5. `api-composition-root-only` allows implementation modules and factories only from
   `@shipfox/api-server` composition files.

Rules should use package names and resolved workspace paths. This catches source-condition imports,
package roots, deep subpaths, and relative paths into sibling packages. Tests must use fake
presentations instead of importing peer implementations. Cross-context integration tests belong at
the application composition or E2E layer.

The final rule set has no broad temporary allowlist. A crossing that cannot migrate gets one exact
path exception with an owner, reason, and tracking issue. The final migration removes that exception
or records it as a new decision.

## Testing model

The foundation provides a test harness that accepts fake presentations. The harness does not depend
on Vitest and does not change process-global state.

Each inter-module API has these checks:

| Test | Proof |
| --- | --- |
| Contract schema tests | Valid JSON input, output, and every known error shape |
| Producer presentation tests | Real application mapping, domain-error translation, and PostgreSQL behavior where persistence matters |
| Transport conformance suite | Valid calls, invalid input, invalid output, known errors, opaque unknown errors, cancellation, tracing, and serialization |
| Consumer tests | Consumer behavior against a fake producer presentation |
| Composition tests | Missing and duplicate presentations, bidirectional clients, calls before sealing, and late registration |
| Packed consumer test | Published `/inter-module` exports, runtime imports, and type imports work outside the monorepo |

The same semantic transport conformance suite runs against the in-memory transport and a focused HTTP
test adapter. Internal exception identity and exact diagnostic text are not parity requirements.

## Release and migration policy

Inter-module contracts are public exports from published DTO packages. Normal package semantic
versioning applies:

- Additive methods and backward-compatible optional fields require a minor changeset.
- Compatible validation or diagnostic fixes require a patch changeset.
- Removed methods, renamed codes, required fields, tighter accepted input, and changed output,
  side-effect, retry, or authorization meaning require a major changeset.

Module factories are also published APIs. Adding a required client to a factory, removing a singleton
module export, or removing an implementation function is breaking. A migration issue includes a major
changeset and migration notes when current consumers can observe that change.

Migration happens one complete producer boundary at a time. A producer contract and presentation land
with all consumers in that issue's scope. Old implementation exports do not become a permanent
compatibility layer. The final migration removes stale dependencies, deep exports, global setters,
and test replacement seams.

Each release change runs package checks, type checks, tests, dependency checks, lockfile checks,
published-artifact checks, and the packed external-consumer gate. The application release closure must
contain every runtime package needed by the new transport and contract exports.

## Consequences

This design adds schemas, presentations, and explicit wiring to local calls. That cost makes the
boundary visible and testable. It also prevents local calls from depending on behavior that a future
serialized transport cannot support.

The composition root becomes the only place that knows the complete graph. A consumer can use a fake
presentation without loading a producer database or configuration. Bidirectional business
relationships no longer require implementation-package cycles or global setters.

The design does not make API bounded contexts separate deployable services. It keeps extraction
possible by preserving serialization, errors, tracing, cancellation, and versioning at the current
in-process boundary.

## Rejected alternatives

### Keep direct implementation calls

Direct calls are small but make internal functions and types the contract. They do not check
serialization, permit deep imports, and encourage shared database and configuration access.

### Adopt oRPC now

oRPC offers contract-first routers and remote links. The current need does not require its router,
middleware, or client-generation surface. Plain TypeScript and Zod fit the existing module and error
conventions with fewer dependencies and less package lock-in.

The decision can be revisited if a separately deployed service needs capabilities that the shared
contract and HTTP transport cannot provide without rebuilding framework behavior.

### Use a dependency-injection container or service locator

A container would hide the application graph behind runtime lookup. A process-global registry would
also couple tests and application instances. Explicit clients and module factories keep dependencies
visible in types and keep transport state isolated.

### Create one contract package per producer

Each producer already has a dependency-light DTO package that owns public schemas and events. Another
package would split one compatibility surface across two packages without a separate owner. The
explicit `/inter-module` export gives the contract a clear boundary inside the existing package.
