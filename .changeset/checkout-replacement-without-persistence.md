---
"@shipfox/api-workflows": patch
---

A checkout with `persist-credentials: false` can now get a fresh credential when the runner reports that the first one was rejected.

- **Replacement scope:** the checkout-token route saves a pending renewal subject for every initial checkout with credentials, not only persisted ones.
- **After success:** a non-persisted checkout still gets no ongoing renewal. Its pending subject is discarded when the step attempt finishes.
- **Response:** a replacement credential keeps the step's `persist` setting instead of always reporting `true`.
