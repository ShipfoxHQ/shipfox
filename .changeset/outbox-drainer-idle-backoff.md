---
"@shipfox/api-dispatcher": patch
---

The outbox drainer doubles its idle wait up to 2 seconds while the outbox stays empty, and a local outbox write ends the idle wait. Claims create no spans, and each dispatched event gets an `outbox.dispatch` span.
