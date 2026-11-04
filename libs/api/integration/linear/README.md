# Shipfox API Integration Linear

Shipfox API Integration Linear provides the Linear provider foundation, OAuth
routes, signed webhook ingestion, hosted MCP adapter, and agent tool catalog. It
is currently enabled behind `INTEGRATIONS_ENABLE_LINEAR_PROVIDER`.

## OAuth callback

Set `LINEAR_OAUTH_REDIRECT_URL` to the public client callback, for example
`https://shipfox.example.com/integrations/linear/callback`. The client forwards
the signed callback query to the authenticated API endpoint, while the API uses
the same configured URL during the server-side token exchange.

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

The OAuth app manifest is the canonical webhook configuration. Configure its
initial webhook resource types as `Issue`, `Comment`, `IssueLabel`, `Project`,
`Cycle`, and `AgentSessionEvent`; Linear applies that app-level configuration
when an organization authorizes the app. Shipfox does not issue a runtime
`webhookCreate` mutation, and there are no earlier installed organizations to
migrate. See [Linear's OAuth app manifests](https://linear.app/developers/oauth-app-manifests).

Supported data webhook events are `Issue`, `Comment`, `IssueLabel`, `Project`,
and `Cycle` with `create`, `update`, or `remove` actions. They publish
`integrations.event.received` with `provider: "linear"`, `source:
connection.slug`, and event names such as `Issue.create`.

`AgentSessionEvent.created` publishes `agentSession.created` for both an
assignment and a comment mention. The raw payload is preserved, including
`agentSession.commentId` and `agentSession.sourceCommentId`, so workflow filters
can distinguish the context. Authors can get the Linear app user id from an
observed event or the Linear app identity, then compare it with `appUserId` in a
filter literal. `AgentSessionEvent.prompted` publishes `agentSession.prompted`;
it can start a subscribed workflow or reach an explicitly configured job listener,
but never automatically resumes a run from its AgentSession. See [Linear's
agent-session behavior](https://linear.app/developers/agent-interaction).

## Agent sessions

The provider advertises the `interaction` capability when it is created with an
`interaction` token store, so people can talk to agents from Linear. It reads two
events:

| Event | Role | Text |
| -- | -- | -- |
| `agentSession.created` | `request` | `promptContext` |
| `agentSession.prompted` | `follow_up`, or `stop` with signal `stop` | `agentActivity.body` |

The conversation key is the agent session ID. A request carries this context, from
`agentSession.issue`: `trigger` (`mention` when `agentSession.comment` is present,
otherwise `delegation`), `team_id`, `team_key`, `labels` (names), `project_id`,
`project_name`, and `issue_identifier`. When the payload doesn't carry the labels,
the project, or the team, the provider reads the issue from the API before routing,
and fails the read, so the event is retried, when that call fails. A follow-up or a
stop carries no context, and a non-stop prompt with no text is ignored.

Linear marks a session unresponsive without an activity within 10 seconds of
`agentSession.created`, which can't wait for the outbox and routing. The webhook
path starts a `thought` activity as soon as it has resolved an active connection,
before it publishes the event, and doesn't wait for it. The webhook response stays
well under Linear's 5 seconds, and a failed acknowledgement is logged without
failing the webhook. A prompt isn't acknowledged, because its session already has
activity.

A turn's reply is an activity on the session, because Linear sets the session's
state from its last activity. `sendReply` posts a `response` activity, or an `error`
activity for a failed turn. A stopped turn's reply is its final activity, which is
how a stop is confirmed. A session that completed days ago still takes the activity,
so a late run result goes on it too. When Linear refuses the activity, with a
rejected request or a lost authorization, the reply becomes a comment on the
session's issue, created as the agent's name so it shows as "via" the app, with the
reply id as the comment id so a repeat is delivered. It is
`undeliverable` when Linear refuses the comment too, or the session has no issue. A
rate limit, a timeout, or an outage fails the call, so the delivery is retried.

`reportProgress` posts each tool call as an ephemeral `action` activity, which the
next activity replaces, and adds the links it receives, such as the run link, to
the session's external URLs, so a link reported earlier stays. The
`idle` state posts nothing, because the reply clears the action.

Signed but unsupported webhook shapes are recorded and dropped with a 200
response so Linear does not retry or disable the webhook endpoint.
## Agent Tool Catalog

The v1 catalog of Linear agent tools covers workspace operations through Linear's
hosted MCP tool ids. It includes read tools for issues, comments, projects,
documents, teams, users, cycles, releases, release notes, release pipelines,
agent skills, diffs, documentation search, and attachments. It also includes
write tools for issue and comment workflows plus project, document, milestone,
release, release note, label, status update, comment, and attachment mutation.

Tool ids intentionally match Linear's hosted MCP server exactly. The catalog is
the local source of truth for authoring validation, write-safety metadata, and
future audit behavior; the provider advertises `agent_tools` and proxies calls
to Linear's hosted MCP server with the connection's stored Linear token.

One tool is native rather than proxied. `download_file` is a `file` tool, so
only action steps can call it. It takes `{url}`, which must start with
`LINEAR_UPLOADS_URL` (`https://uploads.linear.app/` by default). Anything else
fails with `file-location-not-allowed`. It drops the URL's `signature` parameter
and fetches the file with the connection's token. Each hop passes the egress
guard. It follows up to 3 redirects, only to `https` locations, and drops the
token once the origin changes. `LINEAR_UPLOADS_ALLOW_PRIVATE_NETWORKS` lets a
local test server stand in for the uploads host.

Linear reports a missing record, or one the token cannot see, as prose with no
error code. The provider gives those tool errors the `not-found` code, so callers
can tell them from other failures.

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
