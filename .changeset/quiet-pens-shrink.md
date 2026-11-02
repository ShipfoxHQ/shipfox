---
'@shipfox/api-agent': minor
---

Compacts long conversations with pi's compaction. A prompt that nears the context window, or that a provider rejects as too long, is summarized before the model call repeats. The timeline keeps every entry, and only the prompt shrinks. A second compaction for the same call fails the turn with a notice to start a new conversation.
