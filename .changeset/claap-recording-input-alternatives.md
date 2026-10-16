---
"@shipfox/api-integration-claap": patch
"@shipfox/actions": patch
---

`get_recording` and `get_recording_transcript` now declare in their input schema that a call needs `recordingId` or `recordingUrl`, so a tool step without either fails validation before it reaches Claap.
