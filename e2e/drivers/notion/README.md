# @shipfox/e2e-driver-notion

A fake Notion API and event sender for E2E suites. The fake stands in for `api.notion.com` at the address the API reads from `NOTION_API_BASE_URL`. The event helpers post signed page webhook deliveries. Faking Notion is on purpose: it is the external system under integration.

## Public API

- `startNotionApiMock(options?)`: start the fake and return a `NotionApiMock`. It serves page
  reads. `options.accessToken` is the token of the connection the spec creates: the stack router
  sends the fake the requests that carry it, so specs in other workers share the address.
  `options.endpoint` listens directly instead.
- `NotionApiMock.calls`: every page read the fake served, as `NotionApiMockCall` entries.
- `NotionApiMock.writes()`: always empty, because the fake accepts no writes.
- `signNotionHeaders`, `buildPagePropertiesUpdatedEnvelope`, and `postNotionDelivery`: sign and
  send a page webhook delivery.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-notion...
```

## License

MIT
