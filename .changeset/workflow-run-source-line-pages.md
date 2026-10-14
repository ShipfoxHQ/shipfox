---
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": patch
---

`get_workflow_run_source` lets agents read a long workflow file in line ranges. A reply holds up to 96 KiB, up from 16 KiB, and is cut between lines. Each reply gives `start_line`, `end_line`, and `total_lines`. When lines remain, it also gives `next_from_line`; pass that as the new `from_line` input to read the next range.
