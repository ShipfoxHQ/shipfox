---
"@shipfox/api-logs": patch
---

Makes log retention delete object prefixes before stream rows so transient object-storage delete failures leave rows discoverable for a later sweep instead of permanently orphaning billed objects.
