# Shipfox runner base image

`@shipfox/runner-base` builds and verifies the Ubuntu 24.04 AWS image that runner images can start from.

## What it does

- **Base build**: Packer's `base` build prepares an exact Canonical Ubuntu 24.04 AMI and captures an encrypted base AMI in `eu-central-1`.
- **Fresh-instance verification**: Packer's `verify` build launches the captured AMI with a new key pair, checks the base contract, and records the kernel, boot timing, and root filesystem usage. It creates no image.
- **`RUNNER_BASE_PREPARE_OS_SCRIPT`**: the absolute path of the OS preparation script. Release and QEMU runner image builds in `@shipfox/runner-image` run it before their runner stage. Candidate builds start from a published base instead.
- **`computeRunnerBaseRecipe`**: computes the deterministic recipe digest that identifies base compatibility.
- **`parseRunnerBaseMetadata`**: validates one published base generation against [`schema/runner-base.v1.schema.json`](schema/runner-base.v1.schema.json).
- **`runnerBaseImageTags`**, **`RUNNER_BASE_TAGS`**, and **`RUNNER_BASE_POINTER_PARAMETER`**: name the AMI and snapshot tags and the SSM pointer that publication and retention use.
- **Publication**: the `plan-runner-base` and `publish-runner-base` commands decide whether a new generation is needed, then mark a verified pair and write it to the single SSM pointer. The [**Publish runner base**](../../../.github/workflows/publish-runner-base.yml) workflow runs them.
- **Selection**: `selectRunnerBase` and the `select-runner-base` command choose one verified generation for a candidate build. `revalidateRunnerBaseImage` rechecks a selected AMI immediately before launch. `parseRunnerBaseSelection` reads a selection passed between jobs.

The base holds the OS packages and removes snapd and the bundled SSM agent. It keeps cloud-init, SSH, and the source network configuration, so each new instance receives its own identity and launch key. Before capture, the build cleans cloud-init instance state, the machine ID, the hostname, SSH host keys, and Packer's temporary authorized keys.

The base contains no Node, pnpm, Shipfox software, runtime services, or credentials. The runner image stage installs them and applies the final boot, network, and hardening policy.

## Installation and setup

The package is private to this repository:

```json
{
  "dependencies": {
    "@shipfox/runner-base": "workspace:*"
  }
}
```

A dependency on this package only builds its tooling. Only the explicit `build-runner-base` command bakes an AMI.

## Usage

```ts
import {computeRunnerBaseRecipe, RUNNER_BASE_PREPARE_OS_SCRIPT} from '@shipfox/runner-base';

const {digest} = computeRunnerBaseRecipe();
console.log(digest, RUNNER_BASE_PREPARE_OS_SCRIPT);
```

Build and verify one architecture from an exact Canonical source AMI. The command writes the captured AMI, its source, recipe, and verification time to `--output`:

```sh
SOURCE_AMI_ID="$(aws ssm get-parameter --region eu-central-1 \
  --name /aws/service/canonical/ubuntu/server/noble/stable/current/amd64/hvm/ebs-gp3/ami-id \
  --query Parameter.Value --output text)"
turbo build --filter=@shipfox/runner-base
BUILD_ARCH=amd64 BUILD_BASE_GENERATION=local-1 BUILD_SOURCE_AMI_ID="$SOURCE_AMI_ID" \
  BUILD_CANDIDATE_KMS_KEY_ID=alias/shipfox-runner-image-candidate \
  node infra/images/runner-base/bin/build-runner-base.js --output /tmp/runner-base-amd64.json
```

Print the recipe digest and its inputs with `node infra/images/runner-base/bin/runner-base-recipe.js`.

Plan and publish a generation from two build results. `plan-runner-base` writes the decision and the resolved key ARN, and pins the Canonical sources when it decides to build. `publish-runner-base` compares the results with the recipe of a trusted main checkout before writing the pointer:

```sh
node infra/images/runner-base/bin/plan-runner-base.js --output /tmp/runner-base-plan.json
node infra/images/runner-base/bin/publish-runner-base.js \
  --result /tmp/runner-base-amd64.json --result /tmp/runner-base-arm64.json \
  --trusted-root /tmp/trusted-main --build-url https://github.com/ShipfoxHQ/shipfox/actions/runs/1/attempts/1 \
  --output /tmp/runner-base-publication.json
```

## Environment

| Variable | Meaning |
| -- | -- |
| `BUILD_ARCH` | `amd64` or `arm64`. |
| `BUILD_SOURCE_AMI_ID` | Exact Canonical Ubuntu 24.04 AMI. Packer rejects another owner, architecture, or release. |
| `BUILD_BASE_GENERATION` | Unique generation identifier, such as a workflow run and attempt. |
| `BUILD_CANDIDATE_KMS_KEY_ID` | Candidate KMS key for build, plan, and publish. Falls back to `AWS_RUNNER_IMAGE_CANDIDATE_KMS_KEY_ID`. Derived candidates must use the same key. |
| `BUILD_REVISION` | Source revision for the `shipfox.revision` tag. Falls back to `GITHUB_SHA`, then `local`. |

The command needs AWS credentials in the candidate account.

## Behavior notes

The recipe digest covers the Packer templates, the scripts under `scripts/build` and `scripts/verify`, the Packer pin from `mise.toml`, and the Ubuntu release. Plugin pins and storage settings live in the hashed templates. Node and pnpm pins, application code, package tooling, tests, and documentation do not change it.

The base build tags the AMI, its snapshot, and the build instance with `shipfox.base_status=building`.

The build keeps the current package-installation semantics and does not run a distribution upgrade.

### Publication

The **Publish runner base** workflow runs daily, on manual dispatch, and as a reusable workflow (`workflow_call`). It runs only from `main`, because the candidate build role trusts only `main`. Scheduled runs and manual runs build a new generation by default. Callers pass `force: false` to reuse a compatible base; the workflow outputs `mode` and `generation`. Callers must grant `id-token: write` and pass `AWS_RUNNER_IMAGE_ROLE_ARN`.

- **Plan**: resolve the candidate key alias to its key ARN and read the pointer. A pointer is reused only when its recipe and key match, both AMIs are available and tagged `verified`, and its older AMI is at most seven days old. Otherwise, the plan pins the current Canonical Ubuntu 24.04 source for each architecture from the Canonical SSM parameters. It checks owner, architecture, release, and availability.
- **Build**: both architectures build concurrently from the pinned sources under the resolved key ARN, and each passes its fresh-instance verification. The run ID and attempt name the generation.
- **Publish**: check that both AMIs carry the generation's identity tags and that every snapshot uses the key. Then tag the AMIs and snapshots `shipfox.base_status=verified` and write the pointer once. Publication rejects a recipe that trusted main no longer expects, a pair older than seven days, and a generation older than the published one.

The workflow's concurrency group serializes whole runs, so the pointer has one writer. A caller must not use the `runner-base-ubuntu24` group itself. Any failure before the pointer write leaves the previous pointer in place. The run summary reports the plan, both builds with their kernel and boot timing, and the published metadata. The metadata is also uploaded as the `runner-base-metadata` artifact.

To retry a failed publish job, re-run failed jobs: the tag writes are idempotent and a generation that is already published is not rewritten. A build that failed after capturing its AMI cannot reuse the generation's AMI name, so re-run all jobs instead. To stop scheduled publication, disable the workflow in GitHub Actions or remove its schedule. Published bases stay available for inspection.

### Selection

Candidate builds in `@shipfox/runner-image` consume bases through a selection. `select-runner-base --output <path>` reads the pointer and checks it against this checkout. Its recipe must match this checkout's, and its key must match the resolved candidate key. Both AMIs must be available, owned by the pointer's account, of the tagged architecture, and tagged `verified`. The older AMI must be at most seven days old. The selection records the generation, recipe, key ARN, owner, both AMI IDs, and when it was selected. It warns when the older AMI is more than two days old.

`selectRunnerBase` with a `generation` selects that generation from its AMI tags instead of the pointer. It applies the same checks and also checks each snapshot's key. Candidate planning uses it to complete a pair from the generation its surviving image recorded.

`revalidateRunnerBaseImage` rejects a selection older than one day and rechecks the AMI's availability and tags. Base retention keeps every base for nine days, which covers the seven-day selection limit plus the one-day launch window.

## Development

```sh
turbo check --filter=@shipfox/runner-base
turbo type --filter=@shipfox/runner-base
turbo test --filter=@shipfox/runner-base
turbo verify --filter=@shipfox/runner-base
```

`verify` runs `packer init`, `packer fmt -check`, and `packer validate` on this Packer root.

## License

MIT
