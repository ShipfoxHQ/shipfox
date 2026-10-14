---
"@shipfox/api-workflows": patch
---

When a gate restarts an agent step, the agent's prompt now ends with one block that names the failed check, its exit code, the gate feedback and the path of the failed check's log. A prompt that reads `step` gets no block. Without an authored `feedback`, the restart feedback now says "The check `<condition>` returned false." instead of "gate condition not met".
