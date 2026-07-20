---
"@shipfox/inter-module": minor
"@shipfox/node-module": minor
"@shipfox/application-release": patch
---

Adds the registered in-memory inter-module transport: browser-safe contract primitives in `@shipfox/inter-module` (`defineInterModuleContract`, `defineInterModulePresentation`, known-error branding) and `@shipfox/node-module/inter-module` (`createInMemoryInterModuleTransport`, module integration, and a framework-neutral fake-presentation test harness). Extends the packed external-consumer check to cover the new package.
