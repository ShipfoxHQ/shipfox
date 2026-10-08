# Node Feature Flags

Reads feature flags in Node with env overrides, an optional OpenFeature provider, and code defaults.

## What it does

- **`createFeatureFlags({provider?, env?})`** creates the one `FeatureFlags` instance a composition root hands to its modules.
- **`flags.boolean(definition, subject)`** and **`flags.config(definition, subject)`** read a flag declared with [`defineFlags`](../../common/feature-flags/README.md).
- **`flags.validate(definitions)`** is the startup check. It throws on a duplicate key or an invalid `FLAG_*` override.
- **`createTestFeatureFlags(values)`** from `@shipfox/node-feature-flags/testing` is a fake for unit and route tests.

## Installation and setup

```sh
pnpm add @shipfox/node-feature-flags
```

## Usage

```ts
import {createFeatureFlags} from '@shipfox/node-feature-flags';
import {definitionsFlags} from './flags.js';

// With no provider, reads return FLAG_* overrides and code defaults.
const flags = createFeatureFlags();

const enabled = await flags.boolean(definitionsFlags['definitions-actions'], {workspaceId});
```

Pass the instance to `defaultModules({featureFlags: flags})`. Build any policy that reads a flag with the same instance, before you call `defaultModules`.

A test passes a fake through module options:

```ts
import {createTestFeatureFlags} from '@shipfox/node-feature-flags/testing';

const flags = createTestFeatureFlags({'definitions-actions': true});
```

## Environment

A flag override is derived from its definition, not declared in a `config.ts`. `FLAG_<KEY>` uses the key in upper snake case: `FLAG_DEFINITIONS_ACTIONS=true`. A config flag takes JSON.

| Variable | Purpose |
| --- | --- |
| `FLAG_<KEY>` | Overrides one flag for every subject. Wins over the provider and the code default. An empty value is not an override. |

## Behavior notes

- **Resolution order:** env override, provider, code default.
- **A read never throws.** An error, an unknown flag, or a value that fails the schema returns the code default. The package logs once for each flag and reason.
- **The provider is set without waiting.** Reads return defaults until it is ready, so a slow vendor never delays startup.
- **The instance holds no registry.** A definition carries its key, default, and schema, so the instance works before any module exists.
- **OpenFeature stays private.** Modules never import `@openfeature/server-sdk`. Only a composition root or provider adapter handles the `Provider` type, which this package re-exports.
- **Pass an explicit subject.** There is no ambient request context. Read a flag once for each unit of work and pass the value down.
- **Never read a flag in Temporal workflow code.** The value is not deterministic. Read it in an activity.

## Development

```sh
turbo check --filter=@shipfox/node-feature-flags
turbo type --filter=@shipfox/node-feature-flags
turbo test --filter=@shipfox/node-feature-flags
```

## License

MIT
