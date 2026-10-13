---
"@shipfox/api-usage-dto": minor
"@shipfox/api-usage": minor
"@shipfox/api-cache": minor
"@shipfox/api-server": patch
---

Usage records the stored cache bytes of each project once an hour. The Usage contract gains `recordStorageSamples`, which returns the counts of recorded samples and duplicates, and the `listStorageSamples` replay cursor. Usage publishes `usage.storage_sample.recorded` for each new sample. A sample holds quantities only. The Cache module takes a `usage` client and samples `ready` entries at minute 5 of every hour. It records one sample per project, keyed by project and clock hour, so a repeated run records nothing twice.
