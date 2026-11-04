---
"@shipfox/e2e-setup-agent": minor
---

A scripted managed provider reply can be an `error` with a status and message, and any reply can carry a `delay_ms`. A suite can fail a turn on purpose, and act while a reply is still streaming. `registerOpenRouterManagedProvider` takes a `defaultModel`: the catalog model that serves a conversation, which runs on the workspace default.
