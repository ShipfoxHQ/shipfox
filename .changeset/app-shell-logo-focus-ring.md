---
"@shipfox/client-app-shell": patch
---

Fix the missing focus ring on the nav bar's "Shipfox home" logo link. It stripped
the outline but pointed at a non-existent `shadow-button-secondary-focus` token, so
keyboard focus was invisible; it now uses the valid `shadow-button-neutral-focus`.
