---
"@shipfox/api-integration-core-dto": patch
"@shipfox/api-integration-core": patch
"@shipfox/api-agent": patch
---

An `unknown` tool call error now says when the provider may have received the call. A write in a conversation with that error stores the outcome `unknown`, and an `unknown` error from a call the provider rejected, or one that failed before the provider was reached, stays an error.
