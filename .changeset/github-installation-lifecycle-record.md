---
'@shipfox/api-integration-github': minor
'@shipfox/api-integration-core': minor
'@shipfox/api-integration-spi': minor
---

Records a GitHub App uninstall or suspension on the installation and moves the connection to `error`. Unsuspending brings it back to `active`. A user-disabled connection stays disabled, and connecting a suspended installation now writes `error`.
