---
"@shipfox/workflow-document": minor
---

Workflow steps can declare an action with `uses`, and `actionManifestSchema` describes the `action.yml` manifest. Both stay off by default until workflow actions launch.

- **Action steps:** `uses` takes a normalized repository path that starts with `./`. Other forms, such as `owner/repo@ref`, fail with "not supported yet". `connections` binds manifest aliases to connection slugs, and `with` passes inputs. A secret reference in `with` must be the whole value of a top-level input.
- **Forbidden fields:** an action step rejects `run`, agent fields, `checkout`, `tool`, `connection`, and `outputs`. Other step kinds reject `uses` and `connections`.
- **Opt-in:** `parseWorkflowDocument(input, {actions: true})` accepts action steps. Without it, `uses` fails with "Action steps (`uses`) are not supported yet." `buildWorkflowJsonSchema({actions: true})` adds the action fields; the default schema is unchanged.
- **Manifest:** `actionManifestSchema`, `buildActionManifestJsonSchema`, and the `ActionManifest` types cover `name`, `description`, `runtime`, `main`, typed `inputs` and `outputs`, and `integrations` with explicit selectors.
- **Messages:** `with` size, depth, and JSON-tree errors now start with "`with`" instead of "Tool `with`".
