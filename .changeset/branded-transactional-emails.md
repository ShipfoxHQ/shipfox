---
"@shipfox/node-email": minor
---

Add `@shipfox/node-email`: branded MJML + Handlebars transactional email templates (email verification, password reset, workspace invitation) that render to the `{subject, html, text}` shape `@shipfox/node-mailer` sends. Colors follow the product design tokens, dark mode is forced to light for legibility, and every template ships a plain-text fallback. The auth and workspaces modules now send these branded emails instead of bare links, and the workspace invitation shows the workspace name and inviter. The logo is served from the deployment's own client origin (`CLIENT_BASE_URL` + `/email-logo.png`) rather than a third-party CDN, and user-controlled display names are stripped of control characters before rendering so they cannot break the subject line or inject lines into the plain-text body.
