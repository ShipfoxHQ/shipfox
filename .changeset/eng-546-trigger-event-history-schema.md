---
"@shipfox/api-triggers": patch
---

Add the append-only `triggers_received_events` and `triggers_decisions` tables that back the trigger event history. DB layer only: Drizzle schema, inferred types, and row→domain mappers, folded into the triggers module's baseline migration. No write or read path is wired yet.
