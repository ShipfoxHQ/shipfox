# Feature Flags

Runtime-neutral declarations for feature flags: `defineFlags`, flag and subject types, and the checks that keep a flag well formed.

## What it does

- **`defineFlags(specs)`** declares the flags a package reads. The key of each entry becomes the definition's `key`.
- **`FlagSubject`** names who a flag is evaluated for: `{userId?, email?, workspaceId?, anonymousId?}`. An empty subject is global.
- **`checkFlagValue(definition, value)`** checks a value against the flag's kind, and against its Zod schema for a config flag.
- **`parseFlagOverride(definition, raw)`** parses the text of a `FLAG_*` variable.
- **`flagEnvName(key)`** derives the override variable name: `definitions-actions` becomes `FLAG_DEFINITIONS_ACTIONS`.
- **`findDuplicateFlagKeys(definitions)`** returns each key that more than one definition declares.

The package performs no input or output and reads no environment. [`@shipfox/node-feature-flags`](../../node/feature-flags/README.md) reads flags at runtime.

## Installation and setup

```sh
pnpm add @shipfox/feature-flags
```

## Usage

Declare the flags next to the package's `config.ts`:

```ts
import {defineFlags} from '@shipfox/feature-flags';
import {z} from 'zod';

export const definitionsFlags = defineFlags({
  'definitions-actions': {
    kind: 'boolean',
    default: false,
    desc: 'Allows workflow steps to run actions with `uses`.',
  },
  'limits-concurrency-enforcement': {
    kind: 'config',
    schema: z.enum(['off', 'shadow', 'enforce']),
    default: 'off',
    desc: 'How the concurrency limit is applied.',
  },
});
```

## Behavior notes

- **A key is kebab-case** and starts with the context that owns the flag. `defineFlags` throws on any other key.
- **A default must satisfy its kind and schema.** `defineFlags` throws when it does not, so a bad declaration fails at import.
- **A boolean override takes `true` or `false`.** A config override takes JSON, so a string value is quoted: `FLAG_LIMITS_CONCURRENCY_ENFORCEMENT='"enforce"'`.
- **A flag marked `client: true`** is the only kind a web client may read. Server-only flags never reach the browser.
- **The definition's `desc` describes the flag and its override.** Write it in plain language.

## Development

```sh
turbo check --filter=@shipfox/feature-flags
turbo type --filter=@shipfox/feature-flags
turbo test --filter=@shipfox/feature-flags
```

## License

MIT
