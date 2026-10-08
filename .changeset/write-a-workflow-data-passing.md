---
"@shipfox/workflow-templates": patch
---

The `write-a-workflow` skill prefers `export`, output `default`, `from_stdout` and `from_file`, and `$SHIPFOX_ENV` and `$SHIPFOX_PATH` over shell plumbing. It no longer needs `toJson()` to pass a list or a map through `env`.
