---
"@shipfox/api-logs-dto": patch
---

Re-export the schemas through a relative path so the built package loads under a plain Node ESM resolver, not only tsx or vite, which lets Playwright-run E2E suites consume it through `@shipfox/e2e-observe-logs`.
