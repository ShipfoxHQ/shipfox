---
"@shipfox/api-auth": patch
---

Tolerates concurrent refresh-token reuse within a grace window so parallel browser tabs no longer log each other out, and treats reuse past the window as a session compromise.
