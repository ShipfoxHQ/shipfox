# @shipfox/provisioner-core

The provider-agnostic core of a Shipfox provisioner: the control loop that turns
aggregate runner demand into started runners. Docker, and later Kubernetes or EC2,
plug in a provider adapter; everything else here is shared.

## What a provisioner does

A provisioner authenticates with a long-lived provisioner token, then repeatedly:

1. Advertises its current per-template capacity.
2. Long-polls the API for demand and receives count-based reservations.
3. Picks a local template for each reservation's labels.
4. Batch-mints one single-use registration token per planned runner.
5. Hands each planned runner to the provider's launcher.

It never reserves more than its templates have free capacity.

## Public API

- `startProvisioner({adapter})` — run the loop until a shutdown signal. The adapter
  supplies the provider's templates and its launcher.
- `ProvisionerAdapter`, `ProvisionerTemplate`, `LaunchRunner`, `ProvisionedRunnerLaunch`
  — the contract a provider implements.
- `loggingLaunch` — a default launcher that records each planned runner without
  starting it (used until a provider ships a real launcher).
- `ProvisionerAuthenticationError` — thrown at startup when the token is rejected.

## Key pieces (internal)

- **Template selection** (`template-selection.ts`) is deterministic: when several
  templates satisfy a generic label set, the cheapest, then most specific, then
  lowest key wins. Reproducible and unit-tested.
- **Capacity planning** (`capacity.ts`) charges each reservation against free slots,
  filling the cheapest matching template first and spilling to the next.
- **The tick** (`tick.ts`) is one cycle, driven entirely by injected ports so it is
  deterministic to test.

A `ProvisionerTemplate` carries a provider-specific `spec` (a Docker image, a pod
spec) that the loop treats as opaque and only the launcher reads.
