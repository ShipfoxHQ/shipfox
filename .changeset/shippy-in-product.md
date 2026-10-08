---
"@shipfox/react-ui": minor
"@shipfox/client-shell": minor
"@shipfox/client-auth": minor
"@shipfox/client-invitations": minor
"@shipfox/client-projects": minor
"@shipfox/client-workflows": minor
"@shipfox/client-integrations": minor
"@shipfox/client-agent": minor
"@shipfox/client-onboarding": minor
---

Shippy, the Shipfox mascot, appears on first-use, invitation, and dead-end screens.

- **`@shipfox/react-ui`:** `EmptyState` gains an optional `illustration` prop that replaces the icon. The `compact` variant keeps its icon.
- **`@shipfox/client-shell`:** `/runtime` exports `Shippy`, which renders one of nine poses shipped in `assets/shippy`. `AuthShell` gains an optional `illustration` prop that replaces the logo tile. The page-not-found page and the workspace load error page show a pose.
- **`@shipfox/client-auth`:** the workspace creation page shows a pose.
- **`@shipfox/client-invitations`:** the invitation page for a signed-out visitor shows a pose.
- **`@shipfox/client-projects`:** the empty projects list shows a pose.
- **`@shipfox/client-workflows`:** the empty run list shows a pose.
- **`@shipfox/client-integrations`:** the empty installed integrations list shows a pose.
- **`@shipfox/client-agent`:** the empty configured providers list shows a pose.
- **`@shipfox/client-onboarding`:** the completed setup checklist shows a pose in place of the check icon.
