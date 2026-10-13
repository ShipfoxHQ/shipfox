# @shipfox/e2e-driver-notion

A fake Notion API and event sender for E2E suites. The fake stands in for `api.notion.com` at the address the API reads from `NOTION_API_BASE_URL`. The event helpers post signed page webhook deliveries. Faking Notion is on purpose: it is the external system under integration.

## Public API

- `startNotionApiMock(options?)`: start the fake and return a `NotionApiMock`. It serves page
  reads, page content as Markdown, page comments, title search, and data source queries. It also
  accepts new pages, page renames, Markdown replaced or appended to a page, and comments and
  replies, and a read shows each change. `options.accessToken` is the token of the connection the spec creates: the stack router
  sends the fake the requests that carry it, so specs in other workers share the address.
  The token is required unless `options.endpoint` is set, which listens directly instead.
- `NotionApiMock.pages`: the pages the fake serves, by ID, with their title, parent, Markdown, and
  comments. Add to it to seed the fake. A page that was not seeded gets a placeholder on a read,
  and answers not found to a write. With `options.rejectUnseeded`, a read answers Notion's 404
  for a page that was not seeded, and 400 for an id that is not a UUID.
- `NotionApiMock.dataSources`: the data sources the fake serves, by ID, with their rows as pages.
  A query pages the rows by cursor. A data source that was not seeded answers not found.
- `NotionApiMock.calls`: every request the fake served, as `NotionApiMockCall` entries. A write it
  rejected is not in the list.
- `NotionApiMock.writes()`: the pages created (`create_page`), the page updates (`update_page`),
  the Markdown updates (`update_page_content`), and the comments (`add_comment`) the fake
  accepted, as `RecordedWrite` entries targeted at their page, parent, or discussion ID.
- `signNotionHeaders`, `buildPagePropertiesUpdatedEnvelope`, and `postNotionDelivery`: sign and
  send a page webhook delivery.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-notion...
```

## License

MIT
