---
"@shipfox/api-workflows": patch
---

A checkout with `persist-credentials: false` can now get a fresh credential when the runner reports that the first one was rejected.

- **Replacement scope:** this now works for every initial checkout with credentials, including non-persisted ones.
- **After success:** a non-persisted checkout still gets no replacement once its step attempt finishes.
- **Response:** a replacement credential keeps the step's `persist` setting instead of always reporting `true`.
