---
'@shipfox/workflow-document': minor
'@shipfox/api-definitions-dto': minor
'@shipfox/api-definitions': patch
'@shipfox/api-workflows': patch
---

Adds `export` to run, agent, action, and tool steps. `export: true` promotes every declared output of the step to a job output of the same name, and `export: [names]` promotes the listed ones. A later job reads them with the usual types. Sync rejects an unknown name, a clash with the job `outputs` map, and two steps that export the same name. A job output exported from a step that did not produce it is omitted instead of failing the job.
