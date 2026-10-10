---
"@shipfox/actions": minor
"@shipfox/api-integration-core": minor
---

Raise the request limit of an action tool call from 2 MiB to 64 MiB, in the actions SDK, the runner endpoint, and the integration tools gateway. An action can now upload the 40 MiB file GitHub accepts in one `create_blob` call. Agent tool calls keep the 2 MiB limit, which the gateway now enforces by step type. The generated tool types include the new GitHub branch and commit tools and the reworked `create_commit`.
