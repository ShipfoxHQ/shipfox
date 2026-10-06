---
"@shipfox/node-email": minor
---

Add `createEmailRenderer` so other packages can render their own MJML templates with the shared Shipfox theme. Templates include the shared partials with `@shipfox/node-email/partials/<name>.mjml`. `renderEmail` is unchanged, and sanitising now covers values nested in arrays and objects.
