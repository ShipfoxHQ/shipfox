---
"@shipfox/node-jwt": patch
---

Add `durationToSeconds`, which parses a jose timespan string (the same `expiresIn` values `signHs256` accepts, e.g. `90m`, `7d`) into whole seconds. Lets callers reason about a token's lifetime without minting one; units and rounding mirror jose's own parser.
