# Shipfox runner image

`@shipfox/runner-image` builds the VM image used by ephemeral Shipfox platform runners. It produces an AWS AMI with Packer's `amazon-ebs` builder and a raw QEMU image from the same provisioning definition. It does not replace `apps/runner/Dockerfile`.

## Build

Builds run the production deploy inside the target VM. This is required because the runner contains architecture-specific native payloads. The wrapper obtains the Node version from `mise`, prunes `@shipfox/runner`, and then invokes Packer.

```sh
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_NUMBER=42 BUILD_RUNNER_VERSION=0.1.0 pnpm --filter=@shipfox/runner-image image:build
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_NUMBER=42 BUILD_RUNNER_VERSION=0.1.0 pnpm --filter=@shipfox/runner-image exec node ./bin/build-runner-image.js ubuntu24 qemu
```

The AMI source uses Canonical Ubuntu 24.04 and requires AWS credentials in `us-east-1`. The QEMU build defaults to a pinned Canonical Ubuntu 24.04 release image and configures its temporary Packer SSH access through a NoCloud seed; the final image locks that bootstrap account. To use a different QEMU source, set both `SHIPFOX_QEMU_SOURCE_IMAGE` and `SHIPFOX_QEMU_SOURCE_CHECKSUM` (for example, `sha256:<digest>`). Relative source paths resolve from the repository root.

Packer is pinned in `mise.toml`. Install QEMU and `xorriso` through the host operating system before running a QEMU build.

## Environment contract

Cloud-init writes `/etc/shipfox/runner.env`. The provider owns the values and must never bake them into the image:

- `SHIPFOX_API_URL`: API base URL.
- `SHIPFOX_RUNNER_REGISTRATION_TOKEN`: single-use runner registration token.
- `SHIPFOX_RUNNER_LABELS`: comma-separated runner labels.
- `SHIPFOX_POLL_MAX_DURATION_MS`: runner polling deadline. `0` means forever.
- `SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS`: hard instance lifetime. Use a value comfortably above one job's maximum duration.
- `AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS=false`: required for cloud runners.

`shipfox-runner.service` powers off immediately when the runner exits. Its SIGTERM drain budget is 90 seconds, after which systemd can force-kill the process and the backend re-reserves the job. `shipfox-max-lifetime.service` schedules a forced poweroff and falls back to a baked 3600-second limit when the configured value is missing or malformed. AWS builds also enable a Spot IMDSv2 watcher that stops the runner, allows it to drain briefly, then powers off.

With `InstanceInitiatedShutdownBehavior=terminate` and Spot `InstanceInterruptionBehavior=terminate`, provider-side settings convert these poweroffs into EC2 termination. The in-guest watchdog is the fast path. The durable backstop remains tagged-instance reconciliation, the backend staleness reaper, and terminate-on-shutdown because privileged job steps or a wedged kernel can defeat an in-guest timer.

## Recovery drill

On EC2, launch a runner with a short max lifetime, stop the provisioner, and verify the instance terminates before that bound. For Spot, request an interruption notice in a test environment and verify the runner stops claiming work, drains, and powers off before reclaim. These drills feed the EC2 provisioner deployment runbook.

## Release, promotion, rollback, retention

Dispatch the **Build runner image** workflow from `main` with the required architecture, published runner version, and publish option. It assumes the repository's `AWS_RUNNER_IMAGE_ROLE_ARN` through GitHub OIDC, builds an AMI in `us-east-1`, and publishes a strict release catalog to `ghcr.io/shipfoxhq/runner-image-releases`. The catalog is immutable at the source revision and `latest` points to the most recently published two-architecture catalog.

```sh
oras pull ghcr.io/shipfoxhq/runner-image-releases:latest
cat runner-image-release.json
```

Each catalog entry records its AMI ID and region, target architecture, image OS, runner version, build number and attempt, creation time, encryption status, source AMI when AWS reports it, source revision, and GitHub Actions build metadata. The workflow requires the runner version explicitly because `@shipfox/runner` is not independently versioned in this repository. AWS tags are the durable truth: each AMI has `shipfox.managed=true`, plus its revision, runner version, architecture, OS, build number, and build attempt. The catalog is the convenient, machine-readable selection index.

To promote without rebuilding, choose an approved catalog AMI and set that ID in the EC2 provisioner template’s `ami` value. Operators may also move their own `shipfox.channel=stable` tag to the approved AMI. To roll back, point the template or channel at a previous catalog AMI. No image rebuild is needed for either operation.

For retention, keep the last N approved AMIs for each architecture and preserve any image referenced by a deployed template. During the manual drill, deregister an older image and then remove its snapshots only after confirming they are not shared:

```sh
aws ec2 deregister-image --image-id ami-0123456789abcdef0
aws ec2 delete-snapshot --snapshot-id snap-0123456789abcdef0
```

Automated pruning is deferred. The release workflow retains Packer diagnostics on failure so an operator can investigate a failed build before retrying.

QEMU output is test-only and is not published as a distributed artifact. The supported consumer path is a local or CI build followed by a boot test:

```sh
BUILD_ARCH=amd64 BUILD_ATTEMPT=1 BUILD_NUMBER=42 BUILD_RUNNER_VERSION=0.1.0 pnpm --filter=@shipfox/runner-image exec node ./bin/build-runner-image.js ubuntu24 qemu
```

The automated QEMU boot and watchdog suite is tracked in ENG-1022.
