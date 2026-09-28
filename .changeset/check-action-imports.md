---
"@shipfox/api-definitions": patch
---

Adds a relative import check for action bundles: each static `./` or `../` import in a TypeScript or JavaScript action file must resolve to a file inside the action directory. Adds the `es-module-lexer` dependency.
