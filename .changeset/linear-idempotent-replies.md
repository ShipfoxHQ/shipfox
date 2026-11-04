---
'@shipfox/api-integration-linear': patch
'@shipfox/api-integration-spi': patch
---

A retried Linear reply no longer posts the answer twice. `sendReply` uses the `replyId` as the activity `id`. When Linear refuses the activity, the provider looks it up and reports `delivered` if an earlier send landed. `LinearApiClient` gains `hasAgentActivity`, and `createAgentActivity` accepts an `id`. The `replyId` of `SendInteractionReplyInput` is now documented as a UUID that providers use for idempotency when their platform allows it.
