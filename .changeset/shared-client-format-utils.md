---
"@shipfox/react-ui": minor
---

Add shared formatting helpers and the `RelativeTime` component. Exposes `formatTimestamp`, `formatDate`, `humanDuration`, and `formatRelative` utilities plus the `RelativeTime`/`RelativeTimeProvider` components, moving them out of `@shipfox/client-projects` into `@shipfox/react-ui` so every client package shares one implementation. `formatDate` also replaces a separate copy in `@shipfox/client-integrations`.
