---
"@shipfox/api-integration-discord": minor
---

Publishes Discord reactions as `message_reaction_add` events from the Gateway leader. Each event carries an explicit `member.user.bot`, and `root_channel_id` and `url` for the reacted message. The delivery id is `<session_id>:<sequence>`, so resume replays of one session publish a reaction once, and a reaction removed and added again is not dropped. Reactions in a guild without an installed, active connection are dropped.
