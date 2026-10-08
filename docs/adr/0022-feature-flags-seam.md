# ADR 0022: Feature flags seam

- **Status:** Accepted.
- **Date:** 2026-10-07.
- **Decision owners:** Server architecture.
- **Linear issue:** [ENG-3054](https://linear.app/shipfox/issue/ENG-3054/add-the-feature-flags-seam-and-migrate-definition-actions).
- **Amends:** [ADR 0004: Shared semantic packages and server dependency boundaries](0004-shared-semantic-packages-and-server-dependency-boundaries.md).

## Context

**Every rollout and tunable is an environment variable.** Changing one in production needs a pull request, a deploy, and a new build. A value cannot target one workspace or one user.

**A composing application needs per-workspace values without a vendor in the open-source code.** The application can pick a flag service. The open-source repository cannot depend on one, and a self-hosted install must start and behave the same with none.

**Policies are built before the module list.** A composing application creates policies, such as an execution-limits policy, and passes them to `defaultModules` as options. An instance created inside `defaultModules` arrives too late for them.

## Decision

**Two packages hold the capability.**

| Package | Class | Holds |
| --- | --- | --- |
| `@shipfox/feature-flags` | Shared infrastructure, runtime-neutral | `defineFlags`, flag and subject types, the key format check, the value check, and the `FLAG_*` name derivation. It performs no input or output. |
| `@shipfox/node-feature-flags` | Shared infrastructure, Node | `createFeatureFlags`, env overrides, the OpenFeature client, and the `/testing` fake. |

**The runtime-neutral package is not a shared semantic package.** It names no product concept that two contexts jointly own. It is declaration support, like `@shipfox/config`. The Node package reads the environment and wraps a provider SDK, which ADR 0004 forbids in a shared semantic package.

**A package declares the flags it reads.** It calls `defineFlags` next to its `config.ts`. A flag has a kebab-case key, a kind (`boolean` or `config`), a code default, and a description. A config flag also carries a Zod schema. The default must satisfy the kind and schema, or the declaration throws when the module loads. `ShipfoxModule` gains an optional `flags` field.

**The composition root creates one `FeatureFlags` instance.** It calls `createFeatureFlags({provider?})`, builds its policies with that instance, and passes it to `defaultModules({featureFlags})`. With no option, `defaultModules` creates an instance with no provider. `defaultModules` hands the instance to each module factory that reads a flag.

**A read takes the definition and an explicit subject.** `flags.boolean(definition, subject)` and `flags.config(definition, subject)` resolve in this order: the `FLAG_<KEY>` env override, the provider, the code default. The subject is `{userId?, email?, workspaceId?, anonymousId?}`. Upstream has no ambient request context, and this decision adds none.

**A read never throws.** Any error, unknown flag, or schema mismatch returns the code default and logs once for each flag and reason. A provider that is not ready serves defaults, because the provider is set without waiting.

**The instance keeps no registry.** A definition carries its own key, default, and schema, so the instance works before any module exists. `featureFlags.validate(definitions)` is a startup check, not registration. `defaultModules` collects every module's `flags`, rejects a duplicate key, and checks every `FLAG_*` override. An invalid override or a duplicate key fails startup.

**OpenFeature stays private.** No module imports `@openfeature/server-sdk`. The Node package binds each instance to its own OpenFeature domain, so the SDK's global registry is never read by module code. The composition root and provider adapters see only the `Provider` type, which the Node package re-exports. The adapter contract is an OpenFeature `Provider`.

**A flag is not authorization.** Server code checks access first, then reads the flag. Code never reads a flag in Temporal workflow code, because the value is not deterministic. Read it in an activity and pass the value on.

## Consequences

- A composing application can serve flag values from a vendor with one `Provider`, and the open-source application needs none.
- A flip needs no deploy once a provider is wired. Without one, `FLAG_*` overrides and code defaults give the same behavior as today.
- Policies built before `defaultModules` read flags through the same instance as the modules.
- A migrated flag defaults to what production does today, so a provider outage changes nothing.
- `DEFINITION_ACTIONS_ENABLED` is replaced by the `definitions-actions` flag. A deployment that sets it sets `FLAG_DEFINITIONS_ACTIONS` instead.

## Rejected alternatives

### Modules call the OpenFeature global client

A module that calls `OpenFeature.getClient()` reads a global service locator, which the backend rules ban. It also gives no typed registry of declared flags.

### Create the instance inside `defaultModules`

Policies built before `defaultModules` could not read flags. The root owns the instance so they can.

### Chain env overrides as a second OpenFeature provider

A multi-provider chain adds a package and a precedence model for a rule that is a few lines in front of the client.

### A flag registry on the instance

A registry needs every module to register before the first read. A definition that carries its own key and default removes that ordering.
