---
"@shipfox/swc": minor
---

Resolve `#` subpath imports to relative paths in the build output. SWC preserves
`#` specifiers verbatim, so a built `dist/index.js` kept `#schemas/index.js`,
which the `imports` map points at `./src/*` and a plain Node ESM resolver (for
example Playwright or a dist-only image) cannot load. After emitting `dist/`,
`shipfox-swc` now rewrites every `#` specifier (in `from`, side-effect, and
dynamic imports) to a relative path such as `./schemas/index.js`, driven by the
package's own `imports` map. Only string targets are rewritten; conditional
targets are left as-is because they already declare their own runtime resolution.
