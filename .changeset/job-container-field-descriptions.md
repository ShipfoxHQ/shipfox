---
"@shipfox/workflow-document": patch
---

The descriptions of the job `container` fields now state their limits: `image` and `options` cannot read secrets, the image `ENTRYPOINT` and `CMD` do not run, and `options` must not set `--network` or `--entrypoint`.
