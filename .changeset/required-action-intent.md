---
"@shipfox/policy-notice": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-triggers": minor
"@shipfox/api-agent-access": minor
---

A required action can carry an optional `intent`, and `REQUIRED_ACTION_INTENTS` lists the known values. `intent` names a behavior a composing application may provide in place of opening `url`, such as `contact-support`. `url` stays required as the fallback, and an unknown `intent` still parses.

The admission denial contract, the HTTP 409 `required_action`, and the agent-access error details now keep `intent` when it is set.
