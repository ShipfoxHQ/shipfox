---
"@shipfox/api-auth": patch
---

The Auth `stopImpersonationWindow` method now ends every open window the actor has on the workspace, each with its own stop audit event. Before, it ended only the newest one, so an older window kept the workspace open to the admin MCP endpoint. The browser stop route still stops by window ID.
