---
"@shipfox/api-cache-dto": minor
"@shipfox/api-cache": minor
"@shipfox/node-object-storage": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-server": patch
---

Adds the Cache module and the routes a runner calls to save and restore a job cache. A save reserves a key, uploads the archive straight to object storage through signed part URLs, and commits. A restore finds the entry by exact key or restore key and signs a download URL. A dev run saves into a sandbox of the user who started it. The object store gains signed multipart uploads and a `publicEndpoint` option for signed URLs. The Workflows contract gains `getWorkflowRunOrigin`. Set `CACHE_STORAGE_S3_*` to give the cache its own bucket, and give the bucket an `AbortIncompleteMultipartUpload` rule of one day.
