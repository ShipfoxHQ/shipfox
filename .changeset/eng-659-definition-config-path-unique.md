---
"@shipfox/api-definitions": patch
"@shipfox/api-definitions-dto": patch
---

Fix VCS sync failing when a manual definition shares a config_path. The
`definitions_wd_project_id_config_path_unique` index was source-agnostic, so a
manual (or validated) definition and a ref/sha-keyed VCS definition at the same
`config_path` collided on an index that was not the VCS upsert's `ON CONFLICT`
arbiter, raising an unhandled unique violation and breaking sync. The index (and
the manual upsert predicate) is now scoped to manual rows so the two coexist.

A CHECK constraint and request validation now bind `source` to its git
coordinates (vcs rows carry a ref or sha; manual rows carry neither), so the
index predicate's correctness is enforced rather than incidental.
