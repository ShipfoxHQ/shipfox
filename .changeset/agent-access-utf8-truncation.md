---
"@shipfox/api-agent-access": patch
---

Truncates agent-access text to its byte cap in one encoding pass instead of one per character. A full `get_integration_connection_tools` catalog now caps its text about 17 times faster, with the same output.
