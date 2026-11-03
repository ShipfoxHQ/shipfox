---
"@shipfox/client-chat": minor
"@shipfox/client-features": minor
"@shipfox/client-logs": minor
"@shipfox/client-shell": minor
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/client-workflows": patch
"@shipfox/client-projects": patch
---

Add the Shippy chat panel beside every project page.

- **Client chat:** a new package. `chatFeature` contributes the project dock: a panel with a transcript, tool rows, a composer with the page the agent sees, history with delete, and every turn state from thinking to a deleted conversation. `Mod+.` opens or closes it.
- **Client features:** `defaultFeatures()` includes `chatFeature`.
- **Client logs:** exports `groupActivityReads`, `ActivityReadGroupNode`, `ActionDetails`, and `actionDisplayLabel`.
- **Client shell:** `useAgentPageContext()` accepts `undefined`, and its context gains `runNumber` and `name`, which only label the page for the reader.
- **Agent:** `GET /conversations/:conversationId` returns `latest_turn`, with its status, failure code, and model.
- **Agent DTO:** adds `conversationLatestTurnDtoSchema`, and `latest_turn` on `conversationDetailDtoSchema`.
- **Client workflows and projects:** the runs, run, job, automations, and project settings pages tell Shippy where the user is.
