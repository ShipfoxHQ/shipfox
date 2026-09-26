# Shipfox runner base image

`@shipfox/runner-base` builds and verifies the Ubuntu 24.04 AWS image that runner images can start from.

## What it does

- **Base build**: Packer's `base` build prepares an exact Canonical Ubuntu 24.04 AMI and captures an encrypted base AMI in `eu-central-1`.
- **Fresh-instance verification**: Packer's `verify` build launches the captured AMI with a new key pair, checks the base contract, and records the kernel, boot timing, and root filesystem usage. It creates no image.
- **`RUNNER_BASE_PREPARE_OS_SCRIPT`**: the absolute path of the OS preparation script. Complete runner image builds in `@shipfox/runner-image` run it before their runner stage.
- **`computeRunnerBaseRecipe`**: computes the deterministic recipe digest that identifies base compatibility.
- **`parseRunnerBaseMetadata`**: validates one published base generation against [`schema/runner-base.v1.schema.json`](schema/runner-base.v1.schema.json).
- **`runnerBaseImageTags`**, **`RUNNER_BASE_TAGS`**, and **`RUNNER_BASE_POINTER_PARAMETER`**: name the AMI and snapshot tags and the SSM pointer that publication and retention use.

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

## Environment

| Variable | Meaning |
| -- | -- |
| `BUILD_ARCH` | `amd64` or `arm64`. |
| `BUILD_SOURCE_AMI_ID` | Exact Canonical Ubuntu 24.04 AMI. Packer rejects another owner, architecture, or release. |
| `BUILD_BASE_GENERATION` | Unique generation identifier, such as a workflow run and attempt. |
| `BUILD_CANDIDATE_KMS_KEY_ID` | Candidate KMS key. Falls back to `AWS_RUNNER_IMAGE_CANDIDATE_KMS_KEY_ID`. Derived candidates must use the same key. |
| `BUILD_REVISION` | Source revision for the `shipfox.revision` tag. Falls back to `GITHUB_SHA`, then `local`. |

The command needs AWS credentials in the candidate account.

## Behavior notes

The recipe digest covers the Packer templates, the scripts under `scripts/build` and `scripts/verify`, the Packer pin from `mise.toml`, and the Ubuntu release. Plugin pins and storage settings live in the hashed templates. Node and pnpm pins, application code, package tooling, tests, and documentation do not change it.

The base build tags the AMI, its snapshot, and the build instance with `shipfox.base_status=building`. This package does not mark bases as verified or publish the SSM pointer.

The build keeps the current package-installation semantics and does not run a distribution upgrade.

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
