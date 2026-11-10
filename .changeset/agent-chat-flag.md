---
'@shipfox/api-agent-dto': minor
'@shipfox/api-common-dto': minor
'@shipfox/api-agent': minor
'@shipfox/api-server': minor
'@shipfox/client-shell': minor
'@shipfox/client-chat': minor
---

Puts Shippy, the project chat, behind the `agent-chat` flag. The flag defaults to off, so a composition shows no Shippy until `FLAG_AGENT_CHAT=true` is set on the API or its flag provider turns it on for a user or workspace. The conversation routes stay served.

`defaultModules` adds `GET /feature-flags`, which serves every flag declared with `client: true` for the signed-in user and workspace. `@shipfox/client-shell/runtime` adds `useFlag()`, which refetches every 60 seconds, and `@shipfox/client-shell/testing` adds `seedFeatureFlags()`. A project dock contribution can declare `useAvailable`, and the shell hides the launcher, the dock, and the placement control while it returns `false`.
