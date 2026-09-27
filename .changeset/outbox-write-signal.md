---
"@shipfox/node-outbox": minor
---

Adds `onOutboxWrite(listener)`, which calls the listener after each `writeOutboxEvents` insert in the same process and returns an unsubscribe function.
