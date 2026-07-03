---
"@shipfox/docker": patch
---

Uses BuildKit cache-only output for GitHub Actions image validation to avoid importing local Docker images during PR checks.
