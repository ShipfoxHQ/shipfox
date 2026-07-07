# Shipfox API Integration Linear

Shipfox API Integration Linear provides the Linear provider foundation. It is
currently enabled behind `INTEGRATIONS_ENABLE_LINEAR_PROVIDER`; follow-up work
adds OAuth connect routes, webhook ingestion, and hosted MCP execution.

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
