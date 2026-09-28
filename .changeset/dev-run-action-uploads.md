---
"@shipfox/api-definitions": patch
"@shipfox/api-definitions-dto": minor
---

Dev runs now resolve workflow actions. `resolveDefinitionAtRef` reads each referenced action at the pinned commit, or takes it from the new `actions` uploads. An upload replaces its action directory completely. Uploaded snapshots are stored with source `dev_local`. An upload that no step uses gives an `action-upload-unused` warning. A relative import that does not resolve fails the dev run. Local content and action files together are capped at 1 MiB. `@shipfox/api-definitions-dto` exports `actionUploadsSchema` and `MAX_LOCAL_UPLOAD_BYTES`.
