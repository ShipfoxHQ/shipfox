---
"@shipfox/node-module": minor
"@shipfox/api-triggers": patch
"@shipfox/api-workflows": patch
"@shipfox/api-definitions": patch
"@shipfox/api-projects": patch
"@shipfox/api-runners": patch
---

Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
