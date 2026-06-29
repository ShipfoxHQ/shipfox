---
"@shipfox/client-projects": patch
---

Redesign the projects hub cards around source health. Each card now shows the
integration provider logo before the name, drops the raw external repository id,
and replaces the always-green "Connected" badge with a warning that only appears
when the project's source is disconnected (disabled, error, or missing), paired
with a direct "Reconnect" link to the workspace integration settings. Provider
and connection status are joined from the workspace's integration connections,
fetched only when there are projects to annotate.
