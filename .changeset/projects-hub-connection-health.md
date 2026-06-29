---
"@shipfox/client-projects": patch
"@shipfox/client-integrations": patch
---

Redesign the projects hub cards around source health and align them with the
integration gallery cards. Each card now shows the integration provider logo
before the name, drops the raw external repository id, and surfaces a status
pill only when the project's source is not active (Disabled or Error), in the
same inline location as the gallery. The cards adopt the gallery layout
(two-column grid, 16px padding, 24px icon) and carry no call to action.

Extract the connection lifecycle pill into a shared `ConnectionStatusBadge` in
`@shipfox/client-integrations` so the gallery and the projects hub render the
same taxonomy from one source of truth.
