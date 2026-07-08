# Shipfox API Integration Linear

Shipfox API Integration Linear provides the Linear provider foundation. It is
currently enabled behind `INTEGRATIONS_ENABLE_LINEAR_PROVIDER`; it includes OAuth
connect routes and signed webhook ingestion. Hosted MCP execution is follow-up
work.

## Webhooks

Linear sends OAuth application webhooks to:

```text
POST /webhooks/integrations/linear
```

The receiver requires `LINEAR_WEBHOOK_SIGNING_SECRET` to match the signing secret
configured on the Linear app. It verifies `Linear-Signature` against the raw
request body before parsing JSON, rejects signed payloads whose
`webhookTimestamp` is more than 60 seconds from the API server clock, and uses
the `Linear-Delivery` header as the integration delivery id.

Supported data webhook events are `Issue`, `Comment`, `IssueLabel`, `Project`,
and `Cycle` with `create`, `update`, or `remove` actions. Supported deliveries
publish `integrations.event.received` with `provider: "linear"`,
`source: connection.slug`, and event names such as `Issue.create`. Signed but
unsupported webhook shapes are recorded and dropped with a 200 response so
Linear does not retry or disable the webhook endpoint.

## Agent Tool Catalog

The v1 Linear agent tool catalog is a broad workspace catalog over Linear's
hosted MCP tool ids. It includes read tools for issues, comments, projects,
documents, teams, users, cycles, releases, release notes, release pipelines,
agent skills, diffs, documentation search, and attachments. It also includes
write tools for issue and comment workflows plus project, document, milestone,
release, release note, label, status update, comment, and attachment mutation.

Tool ids intentionally match Linear's hosted MCP server exactly. The catalog is
the local source of truth for authoring validation, write-safety metadata, and
future audit behavior; the provider does not advertise `agent_tools` until the
hosted-MCP proxy adapter is implemented.

Sensitivity policy:

- `save_issue` is explicitly `sensitive: false`. It is still a write tool and
  requires `allow_write`, but the v1 product choice treats normal issue triage as
  an ordinary write.
- `save_comment` is `sensitive: false`.
- Destructive or workspace-shaping writes are `sensitive: true`, including
  upload and delete tools, status update mutation, project/document/milestone
  saves, release/release-note saves, and label creation.
- Attachment upload tools are included with their native hosted-MCP names:
  `prepare_attachment_upload`, `create_attachment_from_upload`, and the
  deprecated tiny-file fallback `create_attachment`.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-integration-linear
turbo type --filter=@shipfox/api-integration-linear
turbo test --filter=@shipfox/api-integration-linear
```
