---
"@shipfox/api-integration-linear": minor
"@shipfox/e2e-harness": minor
"@shipfox/e2e-observe-workflows": minor
"@shipfox/worktree-services": minor
---

The Linear API host is configurable, so an E2E stack can fake agent sessions end to end.

- **Linear:** `LINEAR_API_BASE_URL` sets the host of the Linear API for OAuth token exchange and GraphQL calls. It defaults to `https://api.linear.app`.
- **E2E harness:** starts a router for the Linear API fake at the address the API reads from `LINEAR_API_BASE_URL`.
- **E2E observe:** `waitForTriggerEventByDeliveryId` waits for the trigger event of a webhook delivery and returns it with its decisions, so a spec can observe agent routing, which starts no run.
- **Worktree services:** reserves a port for the Linear API fake and sets `LINEAR_API_BASE_URL` in the app environment.
