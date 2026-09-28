---
"@shipfox/workflow-templates": major
"@shipfox/api-agent-access-dto": patch
---

Manifest v2 makes slots, secrets, and variables described objects; replaces `start_label` with required `starts`; and adds `keywords`, `flow`, `writes`, `prerequisites`, and `related`. It removes manifest `id`, `revision`, `added_at`, and `rank`; the loader supplies identity and compatibility metadata beside the manifest.
