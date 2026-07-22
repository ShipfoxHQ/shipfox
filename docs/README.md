# Engineering documentation

This is the map for Shipfox engineering knowledge. It helps contributors and
agents find the source that owns a topic. It does not repeat that source.

Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for a human contribution or
[AGENTS.md](../AGENTS.md) for an agent task. Use this map when the task is not
listed there or when you need to place, update, or review documentation.

## Find context by task

| Read when the task... | Canonical source | It owns |
| --- | --- | --- |
| Needs the product overview or a starting point outside engineering work. | [Root README](../README.md) | Product orientation and repository navigation. |
| Starts a human contribution or needs the normal local workflow. | [Contributing guide](../CONTRIBUTING.md) | Prerequisites, initial setup, contribution workflow, and essential validation. |
| Needs local-task selection, service recovery, or package release procedures. | [Local development and release workflow](guides/local-development-and-release-workflow.md) | Mise, local services, Ollama, affected-package validation, Changesets, and publishing. |
| Changes agent behavior or needs agent execution instructions. | [Agent instructions](../AGENTS.md) | Repository-specific agent execution, change hygiene, and conditional context loading. |
| Adds, updates, or exempts a dependency. | [Dependency version policy](policies/dependency-versions.md) | Version ranges, exceptions, coordinated package families, and dependency checks. |
| Changes a cross-package client composition seam. | [ADR 0001](adr/0001-client-composition-contract.md) | The public client composition contract and its decision rationale. |
| Changes server module boundaries or an inter-module call. | [ADR 0002](adr/0002-api-inter-module-architecture.md) | Producer-owned inter-module contracts and bounded-context crossings. |
| Adds or changes a backend module, DTO, outbox event, HTTP boundary, or server package dependency. | [Backend architecture](architecture/backend-architecture.md) | The current backend module model and package-boundary rules. |
| Adds or changes an environment variable, validator, or environment description. | [Configuration policy](policies/configuration.md) | Repository-wide configuration ownership, validation, and description rules. |
| Adds a domain or provider error, translates a request failure, or reports an unexpected failure. | [Error handling](architecture/error-handling.md) | The current backend error model, client translation, and reporting boundaries. |
| Adds a metric or changes instrumentation startup, naming, units, or labels. | [Observability](architecture/observability.md) | The current backend metrics model and cardinality constraints. |
| Changes client state, API adapters, forms, or feature-domain boundaries. | [Client architecture](architecture/client-architecture.md) | The current client feature model, form rules, and architecture enforcement. |
| Introduces a shared package or changes a server dependency boundary. | [ADR 0004](adr/0004-shared-semantic-packages-and-server-dependency-boundaries.md) | Shared semantic package rules and server package classes. |
| Changes repository documentation structure or adds a shared documentation surface. | [ADR 0005](adr/0005-repository-documentation-architecture.md) | Documentation ownership, routing, and progressive disclosure. |
| Changes webhook retry behavior. | [Webhook retry safety](architecture/webhook-retry-safety.md) | The current safety model for webhook retries. |
| Adds or changes unit tests, Storybook stories, or visual regression coverage. | [Testing guide](guides/testing.md) | Unit-test altitude, Storybook conventions, Argos ownership, build names, and review. |
| Adds or changes end-to-end coverage. | [E2E guide](../e2e/README.md) | Suite levels, HTTP-first setup, screens, and E2E package boundaries. |
| Mints, verifies, or carries an authentication token. | [Auth security model](../libs/api/auth/README.md#security-model) | Token authority, lifetime, trust boundaries, and logging constraints. |
| Defines an inter-module contract or transport. | [Inter-module package README](../libs/shared/common/inter-module/README.md) | Contract primitives and transport responsibilities. |
| Creates or changes a visual or interaction decision. | [Design system](../DESIGN.md) | Shared tokens, components, accessibility, motion, status taxonomy, patterns, and review anti-patterns. Code owns exact token and component values. |
| Writes engineering prose, a README, or a runbook. | [Writing guide](../WRITING.md) | Repository-wide prose structure, style, punctuation, and readability. |
| Writes product or self-hosting documentation. | [Docs writing guide](../apps/docs/WRITING.md) | Product documentation page types, templates, and local terminology. |

## Documentation contract

Each fact has one canonical owner. Other documents may name the fact and link
to its owner. They do not become a second handbook.

Put a task trigger before every conditional context link. State what the link
owns in the same sentence or table row. A reader can then decide whether to
open the target before loading unrelated detail.

Use the narrowest owner that fits the knowledge. A package or subsystem keeps
its local rules even when the map links to them. Do not move local knowledge to
the repository root only to improve discovery.

Executable sources own values and contracts that code can expose or generate.
Examples include scripts, manifests, schemas, defaults, and accepted values.
Authored documentation explains how to use those facts and why they matter.

## Place new knowledge

| Add this kind of knowledge... | Place it in... | That location owns... |
| --- | --- | --- |
| Product orientation. | [Root README](../README.md) | Product introduction and repository navigation. |
| Human setup or contribution workflow. | [Contributing guide](../CONTRIBUTING.md) | Contributor onboarding and normal change workflow. |
| Agent-only execution behavior. | [Agent instructions](../AGENTS.md) or a justified nested `AGENTS.md`. | Agent instructions that do not apply to human contributors. |
| Current cross-package system design. | `docs/architecture/`. | How a system works now. |
| A durable architectural choice and its tradeoffs. | `docs/adr/`. | Decision context, alternatives, and consequences. |
| A repository-wide rule. | `docs/policies/`. | Rules that changes must satisfy. |
| A repository-wide procedure. | `docs/guides/`. | A cross-cutting task and its verification. |
| Details shared by one subsystem. | Its nearest common README. | Subsystem structure and rules. |
| One package's purpose, configuration, or constraints. | Its package README. | Package-specific use and local constraints. |
| End-user or self-hosting information. | `apps/docs/content/`. | Product documentation for its readers. |
| Fast-changing, machine-checkable facts. | Code, a schema, a manifest, or generated reference. | Executable contracts and values. |

Repository engineering documentation and product documentation serve different
readers. Product pages under `apps/docs/content/` follow the docs-app page
types. They do not replace repository policies, architecture, or contributor
guidance.

## Source types

| Source type | Purpose | Use it instead of |
| --- | --- | --- |
| Architecture document | Describe how a cross-cutting system works today. | A historical decision record. |
| ADR | Record a durable decision, its alternatives, and its consequences. | A complete current operating guide. |
| Policy | State a repository-wide rule that a change must meet. | A tutorial or runbook. |
| Guide | Explain a cross-cutting procedure and how to verify it. | Stable reference facts. |
| Subsystem README | Keep knowledge shared by a code subtree close to that subtree. | Repository-wide policy. |
| Package README | Explain one package's purpose, public use, configuration, and constraints. | Unrelated system rules. |
| Product documentation | Help product users and self-hosters use Shipfox. | Contributor or internal engineering guidance. |
| Executable source | Define code-backed values and machine-checkable contracts. | Rationale that code cannot express. |

## ADRs

[The ADR index](adr/README.md) lists every repository-wide decision and its
status. Read an ADR when your change touches its decision boundary. A later ADR
supersedes an earlier one explicitly. Do not rewrite a historical decision to
describe a newer design.

## Maintain this map

Update this map when a canonical source is added, moved, retired, or changes
scope. Keep entries short: state the trigger, link to the owner, and name what
it owns. Do not create empty category directories or placeholder pages only to
fill a table.

If a new documentation surface would create a second shared handbook or split
shared engineering rules between humans and agents, update or supersede
[ADR 0005](adr/0005-repository-documentation-architecture.md) first.
