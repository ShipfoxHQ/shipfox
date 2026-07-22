# Shipfox API Integration Gitea

Shipfox API Integration Gitea connects a Gitea organization to a Shipfox
workspace, receives organization push webhooks, and lets workflow runners check
out repositories through Gitea's git HTTP endpoint.

## Setup

Configure the provider in the API environment:

```sh
GITEA_BASE_URL=https://gitea.example.com
GITEA_SERVICE_USERNAME=shipfox-bot
GITEA_SERVICE_TOKEN=
GITEA_WEBHOOK_SECRET=
GITEA_CHECKOUT_TTL_SECONDS=300
```

`GITEA_BASE_URL` is the URL the API uses for Gitea REST calls and webhook
setup.

`GITEA_SERVICE_USERNAME` and `GITEA_SERVICE_TOKEN` are handed to runners as
checkout credentials. The checkout spec keeps these credentials separate from
the repository URL.

`GITEA_WEBHOOK_SECRET` must match the secret configured on the Gitea
organization webhook.

## Clone URL Override

By default, checkout uses the clone URL reported by Gitea for each repository.
Set `GITEA_CLONE_BASE_URL` when runners reach Gitea through a different scheme,
host, or port than the API does:

```sh
GITEA_BASE_URL=http://localhost:3000
GITEA_CLONE_BASE_URL=http://gitea:3000
```

When set, the provider rewrites only the clone URL origin and keeps the
repository path reported by Gitea. Repository listing, `htmlUrl`, REST API calls,
and webhooks continue to use `GITEA_BASE_URL`.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-integration-gitea
turbo type --filter=@shipfox/api-integration-gitea
turbo test --filter=@shipfox/api-integration-gitea
```

For repository test conventions, read the
[testing guide](../../../../docs/guides/testing.md). This package uses the
`api_test` database, set in `test/env.ts`.
