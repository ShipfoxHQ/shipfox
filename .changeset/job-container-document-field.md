---
'@shipfox/workflow-document': minor
'@shipfox/expression': minor
'@shipfox/api-workflows-dto': minor
'@shipfox/api-definitions': minor
'@shipfox/api-definitions-dto': minor
---

Adds the job `container` field to the workflow document, and the `job.container.*` expression fields. The field is a string or an object with `image`, `credentials`, `env`, `options`, and `docker_socket`. `parseWorkflowDocument` rejects it unless `jobContainers` is set, and `buildWorkflowJsonSchema` leaves it out unless `containers` is set. The workflow model carries the normalized container, and snapshots that include one use version 5.
