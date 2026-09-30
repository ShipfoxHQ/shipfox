# @shipfox/e2e-driver-linear

A fake Linear hosted MCP server for E2E suites. It stands in for the Linear MCP endpoint the API reads from `LINEAR_MCP_ENDPOINT`, so suites exercise the real Linear integration and tool bridge against deterministic responses. Faking Linear is on purpose: it is the external system under integration.

## Public API

- `startLinearMcpMock(options?)`: start the fake and return a `LinearMcpMock`. It serves
  `get_issue` and `save_comment` by default, or the read tools over a
  `LinearWorkspaceFixture` when `options.workspace` is set, plus signed-upload style
  attachment downloads under `uploadsUrl`. Waits for the port when a spec in another worker
  holds it.
- `LinearMcpMock.calls` and `uploads`: every tool call and upload request, in arrival order.
- `LinearMcpMock.writes()`: the accepted state-changing tool calls as `RecordedWrite` entries
  (`kind`, `target`, `payload`). Today that is `save_comment`, targeted at its issue.
- `LINEAR_*_RESULT_MARKER` and `LINEAR_UPLOAD_FIXTURES`: constants the suites assert on.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-linear...
```

## License

MIT
