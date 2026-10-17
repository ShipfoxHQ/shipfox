# Shipfox Process State

Node helper that keeps process-wide state in one place when a package is installed more than once.

## What it does

- **`processState(key, init, moduleUrl)`**: Returns the value stored under `key` on `globalThis`. The first caller creates it with `init`.
- **`duplicatePackageCopies()`**: Lists packages that were loaded from more than one install folder, and whether their copies share state.

## Installation and setup

```sh
pnpm add @shipfox/node-process-state
```

## Usage

pnpm can install the same package version in two folders when its optional peers differ. Node loads each folder as its own module, so a module variable is empty in the second copy. Keep that state in a slot instead.

```ts
import {processState} from '@shipfox/node-process-state';

interface ClientState {
  client?: Client | undefined;
}

const state = processState<ClientState>('@shipfox/example/client/v1', () => ({}), import.meta.url);
```

Read and write `state` instead of a module variable. Every copy of the package now reaches the same object.

Put a state-shape version at the end of the key and bump it when the shape changes. Copies with different versions use different slots, and `duplicatePackageCopies()` reports them as not sharing state.

```ts
for (const duplicate of duplicatePackageCopies()) {
  console.log(duplicate.packageName, duplicate.sharesState, duplicate.copies);
}
```

## Behavior notes

- `moduleUrl` attributes the call to a package copy. The copy is the folder after the last `node_modules/<package>` in the path, or the folder of the nearest `package.json` for a workspace link. A package with state in several files counts as one copy.
- Copies share state when they registered the same slot keys.
- `duplicatePackageCopies()` marks the startup report as taken. A copy that loads afterwards emits a `SHIPFOX_DUPLICATE_PACKAGE_COPY` process warning.
- Do not call `processState` from modules that Temporal workflow code imports. Workflows run in a sandbox with its own `globalThis`.
- `@shipfox/node-module` reports duplicates at startup and can fail startup in strict mode.

## Development

```sh
turbo check --filter=@shipfox/node-process-state
turbo type --filter=@shipfox/node-process-state
turbo test --filter=@shipfox/node-process-state
```

## License

MIT
