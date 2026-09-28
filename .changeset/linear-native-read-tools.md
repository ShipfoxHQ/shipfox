---
"@shipfox/api-integration-linear": minor
---

Adds the native `list_issue_relations` and `list_issue_attachments` Linear tools. They read Linear's GraphQL API and page through every relation, in both directions, and every attachment of an issue. Linear not-found errors, from these tools and from the hosted MCP tools, now carry the `not-found` code. `LINEAR_GRAPHQL_ENDPOINT` overrides the GraphQL endpoint.
