---
'@shipfox/api-integration-spi': minor
'@shipfox/api-integration-core-dto': minor
'@shipfox/api-integration-core': minor
'@shipfox/api-agent-access-dto': minor
'@shipfox/client-integrations': minor
'@shipfox/api-definitions': patch
'@shipfox/api-workflows': patch
'@shipfox/api-server': patch
---

Adds the `interaction` capability to the integration SPI, so people can talk to agents through a provider. A provider declares `interactionEvents`, reads events into interactions, sends replies, and can report progress. Integrations exposes `readInteraction`, `sendInteractionReply`, `reportInteractionProgress`, and `listInteractionProviders` as inter-module operations. `@shipfox/api-integration-spi/testing` exports `createFakeInteractionProvider`.
