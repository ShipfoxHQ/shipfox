---
"@shipfox/runner-protocol": patch
"@shipfox/runner-orchestration": patch
"@shipfox/runner-execution": patch
---

Introduce a `RunnerProtocol` ports seam so the orchestration and execution layers depend on an injectable protocol interface instead of importing the HTTP client directly. `runner-protocol` now exposes a config-free `./contract` (the `RunnerProtocol` / `LeaseProtocol` interfaces — covering `requestNextStep`, `reportStep`, `requestCheckoutToken`, and `appendStepLogs` — plus the `LogAppendFn` / `LogAppendOutcome` types and typed `JobLeaseNotFoundError` / `StepReportRejectedError`), a `createProtocolClient({baseUrl, runnerToken})` factory, and the composed `defaultProtocolClient`; the runner app injects the client into `startRunner({protocol})`, the step loop takes a `LeaseProtocol`, and the setup step takes the lease for its checkout-token call. This lets whole workflows run through the real runner (real execution, real workspace, real log capture, real clone) against an in-memory fake protocol in tests.
