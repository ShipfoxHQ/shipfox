---
"@shipfox/api-integration-core": patch
---

Restructures the integrations composition root so each provider owns its loader, adapter wiring, and migrations-table name in one file under `src/providers/`, registered through a single list; no behavior change.
