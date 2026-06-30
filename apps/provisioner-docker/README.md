# @shipfox/provisioner-docker

Runs the Docker provisioner: it watches aggregate runner demand on the Shipfox API
and starts one-job ephemeral runner containers to meet it.

This app is a thin entry point. The control loop lives in
[`@shipfox/provisioner-core`](../../libs/provisioner/core) and the Docker-specific
configuration and launcher live in
[`@shipfox/provisioner-docker-provider`](../../libs/provisioner/docker).

## What it does

On each cycle the provisioner:

1. Advertises its current per-template capacity (free slots, starting, running).
2. Long-polls the API for demand and receives count-based reservations.
3. Chooses a local template for each reservation's label set, deterministically,
   filling the cheapest matching template first.
4. Batch-mints one single-use registration token per planned runner.

It respects each template's `max_concurrency` before requesting reservations, so it
never reserves more than it can start.

The current launcher logs each planned runner instead of starting containers,
reporting lifecycle, reconciling on restart, or reaping stale containers. Do not run
it against a production API until the launcher is configured to create containers.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SHIPFOX_API_URL` | yes | — | Base URL of the Shipfox API. |
| `SHIPFOX_PROVISIONER_TOKEN` | yes | — | Long-lived provisioner token (keep it in `.env.local`, never commit it). |
| `SHIPFOX_PROVISIONER_TEMPLATES_FILE` | yes | — | Path to the YAML template file (see `templates.example.yaml`). |
| `SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS` | no | `30` | Long-poll wait per demand request. |
| `SHIPFOX_PROVISIONER_POLL_INTERVAL_MS` | no | `1000` | Base delay between polls; backs off on error. |
| `SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS` | no | `5000` | Backoff ceiling. |
| `SHIPFOX_PROVISIONER_MAX_RESERVATIONS` | no | `250` | Most reservations requested per poll (also capped by free capacity and the API's limit of 1000). |
| `SHIPFOX_PROVISIONER_REGISTRATION_TOKEN_BATCH_SIZE` | no | `250` | Tokens minted per request (1–1000). |
| `SHIPFOX_RUNNER_POLL_MAX_DURATION_MS` | no | `300000` | Injected into each runner as `SHIPFOX_POLL_MAX_DURATION_MS`. |

## Run locally

```sh
# Set SHIPFOX_PROVISIONER_TOKEN in apps/provisioner-docker/.env.local first.
pnpm --filter=@shipfox/provisioner-docker dev
```
