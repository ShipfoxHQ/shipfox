---
"@shipfox/e2e-setup-agent": minor
---

A scripted managed provider reply can be an `error` with a status and message, and any reply can carry a `delay_ms`. A suite can fail a turn on purpose, and stop a reply while it is still streaming. `registerOpenRouterManagedProvider` takes an optional `defaultModel`: the catalog model that serves requests made for the workspace default model.
