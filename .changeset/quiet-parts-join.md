---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions": minor
---

Lets an agent step `prompt` be a list of up to 64 parts. A part is a string or a `{file: ./path}` reference. The normalizer joins string parts with a blank line, and a string `prompt` is unchanged. A `file` part fails with `prompt-file-invalid` until prompt files are supported.
