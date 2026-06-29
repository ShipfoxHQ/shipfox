---
"@shipfox/api-definitions": patch
---

Fix VCS sync failing when a manual definition shares a config_path. The
`definitions_wd_project_id_config_path_unique` index was source-agnostic, so a
manual (or validated) definition and a ref/sha-keyed VCS definition at the same
`config_path` collided on an index that was not the VCS upsert's `ON CONFLICT`
arbiter, raising an unhandled unique violation and breaking sync. The index (and
the manual upsert predicate) is now scoped to manual rows so the two coexist.
