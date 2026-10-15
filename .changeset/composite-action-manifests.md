---
"@shipfox/workflow-document": minor
"@shipfox/expression": minor
"@shipfox/api-definitions": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/actions": patch
---

An `action.yml` can set `steps` instead of `main` to declare a composite action. Sync expands it into the definition model. Composite actions cannot run yet, so sync rejects them unless `compositeActionsEnabled` is set.

- **Manifest:** `ActionManifest` is a JavaScript or a composite manifest. A composite manifest has no `runtime`, `post`, or `post_failure`. Its outputs need `value`, and its inputs can set `secret: true`. Inner steps reject `checkout` and `export`, and a tool step needs `connection`. `uses:` and prompt `file:` accept a leading `${{ action.path }}/`. `safeParseActionManifest` rejects composite manifests unless `compositeActions` is set.
- **Expressions:** `action` is a reserved root, readable only inside a composite action. `buildCompositeScopeEnvironment` types its inner `inputs` and `action`, and `action.outputs` is the field for an output `value`.
- **Resolution:** composite actions are resolved recursively, at most 5 levels deep. A cycle fails with the new `action-cycle` sync error code, and deeper nesting with `action-nesting-too-deep`. The 20-action limit counts the whole tree, and the content hash covers every action and prompt file in it.
- **Workflow model:** a `composite` step holds its inner steps, with path ids, scoped `inputs` and `steps`, secret inputs rewritten to the caller's references, and aliases bound to the caller's connections. A nested grant must fit inside its outer alias. Source locations can name the composite file. Snapshots with a composite step use version 6, and `flattenJobSteps` lists a job's steps in run order.
