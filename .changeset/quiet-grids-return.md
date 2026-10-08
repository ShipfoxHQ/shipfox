---
"@shipfox/client-integrations": minor
---

Adds an opt-in connected state to the provider grid and a return target for installs. With `showConnectionState` and `connections`, the grid shows a provider with an active connection as connected, with an "Add another" action. With `returnTo`, an install started from the grid sends the user to the workspace home when the callback succeeds. Without either prop, the grid and the callbacks behave as before.
