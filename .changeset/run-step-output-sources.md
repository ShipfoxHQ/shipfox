---
'@shipfox/workflow-document': minor
'@shipfox/expression': minor
'@shipfox/api-definitions': patch
'@shipfox/api-workflows': patch
---

Adds `from_file` and `from_stdout` to run step output declarations. A run step can read an output from a file in the job workspace or from its standard output, up to 64 KiB, instead of writing to `$SHIPFOX_OUTPUT`. The run dispatch config carries them as `output_sources`.
