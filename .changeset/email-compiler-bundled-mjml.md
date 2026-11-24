---
"@shipfox/email-compiler": patch
---

`@shipfox/email-compiler` bundles MJML and has no runtime dependencies, so installing it no longer brings `mjml` and its CSS tooling into the consumer's graph. That tooling gave packages installed alongside it, such as `@shipfox/node-temporal`, a second installed copy, even when the compiler was a development dependency. The licenses of the bundled packages ship in `dist/third-party-licenses.txt`.
