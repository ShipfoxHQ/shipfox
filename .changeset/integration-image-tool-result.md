---
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/actions": minor
---

Add the `image` tool result kind. A provider marks a tool that returns images with `result: 'image'`. An agent step can call it and receives the image blocks. A tool step that names it fails validation with `integration-tool-agent-only`, and an action cannot call it: the generated action tool types leave it out and the action endpoint refuses the call.
