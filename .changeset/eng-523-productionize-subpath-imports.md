---
"@shipfox/docker": patch
---

Point each pruned package's `#*` subpath imports at the built `dist/` when preparing a node app's build context. The image runs the prebuilt `dist/` with plain `node`, so `import '#core/run.js'` must resolve to `./dist/core/run.js`; the unconditional `./src/*` the source uses would resolve to a TypeScript file the image does not ship. A `development` condition keeps `tsx` on `src/`, so only the pruned context's runtime resolution changes.
