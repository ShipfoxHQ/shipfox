# @shipfox/e2e-driver-linear

A fake Linear hosted MCP server and signed webhook sender for E2E suites. The server stands in for the Linear MCP endpoint the API reads from `LINEAR_MCP_ENDPOINT`, so suites exercise the real Linear integration and tool bridge against deterministic responses. Faking Linear is on purpose: it is the external system under integration.

## Public API

- `startLinearMcpMock(options?)`: start the fake and return a `LinearMcpMock`. It serves
  `get_issue` and `save_comment` by default, or the read tools over a
  `LinearWorkspaceFixture` when `options.workspace` is set, plus signed-upload style
  attachment downloads under `uploadsUrl`. `options.accessToken` is the token of the
  connection the spec creates: the stack router sends the fake the requests that carry it, so
  specs in other workers share the address. The token is required unless `options.endpoint`
  is set, which listens directly instead.
- `LinearMcpMock.calls` and `uploads`: every tool call and upload request, in arrival order.
- `LinearMcpMock.writes()`: the accepted state-changing tool calls as `RecordedWrite` entries
  (`kind`, `target`, `payload`). Today that is `save_comment` and `save_issue`, targeted at their
  issue. A `save_issue` without an `id` creates an issue, numbered from `ENG-101` for team `ENG`,
  and its write targets the team.
- `postLinearIssueUpdate(params)` and `postLinearAgentSession(params)`: post a signed `Issue`
  update or `AgentSessionEvent` (`created` or `prompted`) delivery to the API's Linear webhook
  route and return its `Linear-Delivery` ID, for correlating a run when a matching trigger starts
  one. Signing reads `LINEAR_WEBHOOK_SIGNING_SECRET`, which the E2E harness sets.
  `organizationId` must be the organization of a connection made with `createLinearConnection`.
- `buildIssueUpdateEnvelope` and `buildAgentSessionEnvelope`: the payloads, in the shape of
  Linear's webhooks, for suites that post them another way. An issue fixture can carry `teamKey`,
  `description`, and `labels`, and an update can carry `previousLabelIds`, so triggers that filter
  on the team or on an added label see them.
- `LINEAR_*_RESULT_MARKER` and `LINEAR_UPLOAD_FIXTURES`: constants the suites assert on.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-linear...
```

## License

MIT
