# Shared node rules

This directory contains Biome rules for the shared node packages in
`libs/shared/node`. These rules are repository-local. The `@shipfox/biome`
package doesn't publish or export them.

## `shared-node/no-module-state`

pnpm can install one package version in several folders. Node loads each
folder as a separate module, so a module variable that one copy sets is empty
in the other. Shared node packages keep process state in `processState` slots
from `@shipfox/node-process-state` instead. Every copy then reads the same
value, and `@shipfox/node-module` reports the duplicate at startup.

The rule rejects these declarations at module scope in `src/`:

- `let` and `var`.
- A `Map`, `Set`, `WeakMap`, or `WeakSet` that the file writes to with `set`,
  `add`, `delete`, or `clear`.

It allows:

- A `const` collection that the file never writes to.
- A value returned by `processState`, including a collection.
- Variables inside functions, blocks, loops, and class static blocks.

Test files are out of scope.

Move the state into a slot to fix a finding. Don't suppress the rule. A
reviewed exception is an exact file exclude in the root `biome.json`, recorded
as described in the [architecture validation guide](../../../../docs/guides/architecture-validation.md#exceptions).
