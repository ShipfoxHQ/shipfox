# Agent Provider E2E Driver

`@shipfox/e2e-driver-agent-provider` provides a deterministic OpenAI-compatible
provider for E2E tests. It is strict test infrastructure: suites register it as a
normal custom model provider through product HTTP routes, while the fake provider
itself stays outside the API app.

This package currently owns the in-process HTTP server and script engine. The
child-process sidecar wrapper is added separately so flow suites can keep the
provider alive across Playwright `globalSetup` and worker processes.

## HTTP Surface

Control endpoints require the server admin token:

```text
GET  /healthz
POST /scripts
POST /scripts/:scriptId/reset
GET  /scripts/:scriptId/requests
```

Provider-compatible endpoints bind to `127.0.0.1` and intentionally do not
require auth:

```text
POST /scripts/:scriptId/v1/chat/completions
```

Scripts advance one response per provider request. Exhausted scripts return
`409 script_exhausted`; assertion failures return `422 script_assertion_failed`.
