---
"@shipfox/node-email": minor
---

Add `createEmailRenderer` so other packages can render their own MJML templates with the shared Shipfox theme. `renderEmail` is unchanged, and sanitising now covers values nested in arrays and objects.
