---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
---

`startDevRun` accepts an optional `devSource.definitionSource` (`'ref' | 'local'`, default `'ref'`), and dev-run sources expose `definition_source`, so callers can tell whether a workflow definition came from the repository at a ref or was sent in the request.
