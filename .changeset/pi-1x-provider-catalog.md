---
"@shipfox/api-agent-dto": minor
"@shipfox/api-agent": patch
---

The Pi harness now runs on Pi 1.x.

- **Agent DTO:** `piModelProviderId` maps a Shipfox provider ID to the Pi provider ID. Pi 1.x renamed `azure-openai-responses` to `azure`, and stored provider configs keep the Shipfox ID. `isReservedModelProviderId` now also reserves `azure`, so new custom providers cannot take Pi's built-in ID. The catalog lists Pi's new `meta`, `radius`, and `typesafe` providers as unsupported. Fireworks now defaults to `accounts/fireworks/models/kimi-k3` and Together AI to `deepseek-ai/DeepSeek-V4-Pro-0813`, because Pi removed the previous defaults.
- **Agent:** Azure OpenAI model lists and credential checks use the renamed Pi provider again.
