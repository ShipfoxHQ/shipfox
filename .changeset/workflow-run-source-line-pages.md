---
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": patch
---

`get_workflow_run_source` now returns the whole workflow file. A reply holds up to 96 KiB of whole lines, up from 16 KiB cut at a byte. Each reply gives `start_line`, `end_line`, and `total_lines`. When lines remain, it also gives `next_from_line`; pass that as the new `from_line` input to read the next range.
