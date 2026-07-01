# @shipfox/node-jwt

## 0.1.0

### Minor Changes

- fb64f13: Extracts the HS256 sign/verify mechanics into a shared `@shipfox/node-jwt` package and refactors auth user-token signing onto it, leaving the auth public API unchanged.

### Patch Changes

- b0a0e1a: Add `durationToSeconds`, which parses a jose timespan string (the same `expiresIn` values `signHs256` accepts, e.g. `90m`, `7d`) into whole seconds. Lets callers reason about a token's lifetime without minting one; units and rounding mirror jose's own parser.
