---
"@shipfox/client-shell": minor
"@shipfox/client-workflows": patch
"@shipfox/client-agent": patch
---

`@shipfox/client-shell` exports `RequiredActionLink`, `RequiredActionDefaultLink`, and `RequiredActionTrigger`, and `ChromeSlots` gains an optional `RequiredActionIntent` slot for actions that carry an `intent`. Every required action now renders through one URL rule: relative and same-origin URLs open in the same tab, other `http(s)` origins open in a new tab, `mailto:` URLs are plain links, and any other URL shows the message as text.

Workflow and agent surfaces render required actions through it. The duration notice's billing link now opens in the same tab.
