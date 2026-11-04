---
"@shipfox/api-workflows": patch
---

Run admission rejects a job that sets no `checkout` on a managed project whose access names one repository when that repository's connection is missing or not active, instead of checking out nothing.
