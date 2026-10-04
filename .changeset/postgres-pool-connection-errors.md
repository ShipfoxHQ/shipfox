---
'@shipfox/node-postgres': patch
---

Keep the process running when PostgreSQL drops a pooled connection. The query in flight still rejects.
