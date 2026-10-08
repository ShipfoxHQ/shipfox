---
"@shipfox/workflow-templates": patch
---

Templates use `export`, output `default` and `from_stdout` instead of copying step outputs into job outputs by hand. `fix-default-branch-ci` defaults the `package` outputs and reads its patch with `from_file`. Templates no longer wrap lists in `toJson` where the value is only stringified.
