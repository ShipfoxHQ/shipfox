# @shipfox/e2e-driver-posthog

Helpers for the PostHog MCP fake that the E2E harness starts (`e2e/harness/src/posthog-mock.mjs`). The fake runs in the harness process, so this driver reads what it recorded and controls its behavior through `/__e2e` routes at `POSTHOG_API_BASE_URL`. PostHog is read-only for Shipfox, so it has no `writes()`.

## Public API

- `posthogMockCalls(apiKey)` and `posthogMockMcpRequestCount(apiKey)`: read the calls the
  fake recorded for a key.
- `waitForPosthogMockCall(apiKey)`: poll until the first call for a key arrives.
- `seedPosthogMock({apiKey, seed})`: make the fake answer `execute-sql` (event counts) and
  `feature-flag-get-all` for a key with PostHog-shaped results. A key without a seed keeps the
  marker answers.
- `setPosthogProbeStatus(apiKey, status)` and `releasePosthogCall(apiKey)`: steer the fake's
  probe answer and release a held call.

## Local Checks

```sh
mise exec -- turbo check type --filter=@shipfox/e2e-driver-posthog...
```

## License

MIT
