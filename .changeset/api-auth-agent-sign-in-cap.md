---
"@shipfox/api-auth": patch
---

Caps agent sign-ins at 30 days from the last consent. Refresh tokens issued on an agent grant now expire no later than 30 days after the user last approved the connection, and approving again resets the clock. Existing grants get 30 days from the migration.
