# E2E Runner Process Driver

Runner capacity for an end-to-end suite: provisioner tokens, a Docker provisioner, a local runner, and a job container image.

## What it does

- **`mintProvisionerToken`** creates a workspace provisioner token.
- **`mintInstallationProvisionerToken`** creates an installation-wide token with the administrator route and an idempotency key.
- **`startProvisioner` and `stopProvisioner`** run a Docker provisioner for the length of a suite. The provisioner starts real runner containers, the same way production does.
- **`pollDemand` and `pollDemandUntil`** send authenticated demand polls without starting a runner.
- **`mintManualRegistrationToken`** creates a manual runner registration token.
- **`startLocalRunner`, `stopLocalRunner`, `waitForLocalRunnerExit`, and `localRunnerLogTail`** run one runner as a host process.
- **`publishJobContainerImage` and `removePublishedJobContainerImage`** build an image and serve it from a local registry, for a job `container`.

`startProvisioner` has two modes:

| Mode | Starts | Use it when |
| --- | --- | --- |
| `source` (default) | `@shipfox/provisioner-docker` from the repository, through `tsx` | The suite lives in the Shipfox repository and tests unreleased provisioner code. |
| `image` | A released provisioner image, with `docker run` | The suite lives in another repository. |

`startLocalRunner` runs from source only. A suite outside the Shipfox repository gets a self-hosted runner from a provisioner started in image mode.

## Installation and setup

Install the package in an E2E consumer:

```sh
pnpm add @shipfox/e2e-driver-runner-process
```

Image mode needs:

- A Docker daemon with its socket at `/var/run/docker.sock`.
- An API that listens on an address the Docker bridge reaches. On Linux, `host-gateway` is the bridge address, so an API bound to `127.0.0.1` refuses the connection. Bind `0.0.0.0`.
- A provisioner image and a runner image built from the same revision as the API. The templates file names the runner image.

Source mode needs the app each helper runs in the `package.json` of the suite:

| Helper | App |
| --- | --- |
| `startProvisioner` in source mode | `@shipfox/provisioner-docker` |
| `startLocalRunner` without `installDir` | `@shipfox/runner` |

This package does not depend on them, because they are not published. Turbo then builds them before `test:e2e`.

Installation-scope demand polling requires the API to run with `E2E_ENABLED=true` and `E2E_ADMIN_API_KEY` set. Without this E2E installation policy, the demand route returns `403`.

## Usage

Start a provisioner from a released image, run the suite, and stop it:

```ts
import {
  mintProvisionerToken,
  startProvisioner,
  stopProvisioner,
} from '@shipfox/e2e-driver-runner-process';

const workspaceId = '<workspace id>';
// A user session bearer. The shared E2E administrator key does not satisfy these routes.
const userToken = '<session token>';

const token = await mintProvisionerToken({workspaceId, userToken});
const handle = await startProvisioner({
  mode: 'image',
  image: 'ghcr.io/shipfoxhq/provisioner-docker@sha256:<digest>',
  workspaceId,
  userToken,
  provisionerToken: token.raw_token,
  tokenPrefix: token.prefix,
  templatesFile: '/abs/path/to/templates.e2e.yaml',
  logFile: '/abs/path/to/provisioner.log',
  // The first start pulls the image, which takes longer than the 30 s default.
  readinessTimeoutMs: 120_000,
});

await stopProvisioner(handle);
```

## Environment

| Variable | Purpose |
| --- | --- |
| `API_URL` | Host URL of the API under test. Read through `@shipfox/e2e-core`. |

## API

### `mintProvisionerToken(params)`

Calls `POST /workspaces/:workspaceId/provisioners/tokens` and returns the created token. Pass `raw_token` to `startProvisioner`. The API returns it only once.

### `mintInstallationProvisionerToken(params)`

Calls `POST /admin/runners/provisioner-tokens` with the administrator bearer and an `Idempotency-Key`. The helper supplies an E2E reason by default and returns the raw token once.

Installation readiness uses `adminToken` and the administrator runner-capacity read for `workspaceId`; workspace readiness uses `userToken` and the workspace active-provisioner read.

### `pollDemand(params)` and `pollDemandUntil(params)`

`pollDemand` sends one request to `POST /provisioners/demand/poll` using the provisioner bearer. Templates use `{name, labels}` and advertise one available slot by default. A reservation grant throws immediately because this driver has no runner to claim it.

`pollDemandUntil` repeats the request every `intervalMs` (default 1 second), calls the async `until` predicate after each response, and rejects with `DemandPollTimeoutError` containing the last response and `pollCount` after `timeoutMs` (default 30 seconds). An early poll may find no demand because run creation is asynchronous.

### `startProvisioner(params)`

Starts the provisioner, appends its output to `logFile`, and resolves once the provisioner is active for the workspace. It rejects, after stopping the provisioner, when the process exits first or the readiness budget (default 30 s) runs out. Keep `logFile` as a CI artifact.

| Parameter | Mode | Purpose |
| --- | --- | --- |
| `mode` | both | `source` (default) or `image`. |
| `scope` | both | `workspace` (default) or `installation`. |
| `workspaceId` | both | Workspace used for readiness. Installation scope uses its administrator capacity read. |
| `userToken` | workspace | User session bearer that polls active provisioners. |
| `adminToken` | installation | Administrator bearer used for the capacity readiness read. |
| `provisionerToken`, `tokenPrefix` | both | The token, and its prefix to match in the active list. |
| `templatesFile`, `logFile` | both | The templates YAML and the log file. |
| `readinessTimeoutMs` | both | Readiness budget. |
| `apiUrl` | both | Host API URL. Defaults to `API_URL`. |
| `image` | image | Provisioner image reference. Required. |
| `containerApiUrl` | image | API URL for the provisioner container. Defaults to the host API URL with its host replaced by `host.docker.internal`. |
| `runnerApiUrl` | both | API URL for runner containers. Image mode defaults it to `containerApiUrl`. |
| `dockerExtraHosts` | both | Host mappings for runner containers. Image mode defaults it to `host.docker.internal:host-gateway`. |
| `dockerNetwork` | both | Docker network that runner containers join. |
| `entryPath` | source | Overrides the provisioner source entry. |

### `stopProvisioner(handle, options?)`

Sends `SIGTERM`, then `SIGKILL` after a grace period (default 15 s), so the provisioner removes its own containers. It then removes every container that still carries the `shipfox.provisioner_id=<id>` label. In image mode it also removes the provisioner container. The cleanup is best-effort: a Docker failure is written to stderr, not thrown.

### `mintManualRegistrationToken(params)`

Creates a manual registration token for `startLocalRunner`.

### `startLocalRunner(params)`

Runs `@shipfox/runner` as a host process, from source through `tsx`. Pass `installDir` to run a deployed runner with plain Node instead, as the runner image does.

```ts
const runner = startLocalRunner({workspaceId, registrationToken, labels, logFile});
await stopLocalRunner(runner);
```

### `publishJobContainerImage(params)`

Starts a `registry:2` container on a loopback port, builds the image from `contextDir`, pushes it, and returns the reference a job `container` names. The runner always pulls the job image, so an image in the local image store alone is not enough. `removePublishedJobContainerImage(published)` removes the registry and the local image.

```ts
const published = await publishJobContainerImage({
  contextDir: '/abs/path/to/fixture',
  name: 'shipfox-e2e/toolbox',
  uniqueId,
});
// published.image is "127.0.0.1:<port>/shipfox-e2e/toolbox:e2e"
await removePublishedJobContainerImage(published);
```

## Behavior notes

### Networking in image mode

The host and the containers reach the API at different addresses. Inside the provisioner container, `localhost` is the container itself. The runner containers are its siblings, created through the Docker socket, so they don't inherit its host mapping.

Image mode sets four values:

| Who | Reaches the API at | Set through |
| --- | --- | --- |
| The test process | `apiUrl` | Readiness polling. |
| The provisioner container | `containerApiUrl` | `SHIPFOX_API_URL` and `--add-host host.docker.internal:host-gateway`. |
| Each runner container | `runnerApiUrl` | `SHIPFOX_RUNNER_API_URL` and `SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS` on the provisioner. |

- **A loopback `containerApiUrl` is refused before `docker run`.** This covers `localhost`, `*.localhost`, `127.0.0.0/8`, and `::1`.
- The provisioner token reaches the container through the environment of `docker run`, so it does not appear in the process arguments.
- The templates file is mounted read-only at `/etc/shipfox/templates.yaml`.

### Source mode

The app `dist` output still contains `#*` imports that resolve to source, so source mode runs the same entry as `pnpm dev`. The driver looks for the app from its own location, then from the working directory of the suite. It fails with a message that names the missing app.

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-driver-runner-process
turbo type --filter=@shipfox/e2e-driver-runner-process
turbo build --filter=@shipfox/e2e-driver-runner-process
turbo test --filter=@shipfox/e2e-driver-runner-process
```

The unit tests cover the `docker run` arguments and the environment of each mode, installation token headers, demand polling, reservation guards, and timeout behavior. Process spawning, signals, and readiness are covered by the E2E suites that start capacity.

## License

MIT
