---
"@shipfox/api-agent": minor
---

Adds reply delivery for conversations started from an integration. After each turn, Agent asks the provider to send the answer, or an error when the turn failed or was denied, and a stopped turn sends its partial text or "Stopped.". Each tool call is reported as working, and the provider's progress is cleared when the turn ends. A `stop` interaction asks the running turn to stop. A reply the provider can't take is recorded as a notice on the conversation and is not retried. A crash between the provider accepting a reply and Agent recording it can send the reply twice. Providers that implement the interaction capability don't send replies yet.
