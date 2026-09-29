---
"@shipfox/workflow-templates": major
---

`TemplateLoader` is asynchronous and version-aware.

- **Interface:** `list`, `get({package, version?})`, `versions({package})`, and `compose({package, version?, bindings, options?})` return promises. `get` and `compose` take the latest version when `version` is omitted, and `compose` applies `options` to the YAML.
- **Templates:** `WorkflowTemplate` and `WorkflowTemplateAsset` carry a `version`, and `WorkflowTemplate` a `package` name (`shipfox/<id>`). A bare id still names the first-party package, through `resolveTemplatePackage`.
- **Directory loader:** `createDirectoryTemplateLoader(path)`, exported from `@shipfox/workflow-templates/testing`, serves a catalog directory.
- **Removed:** `listShippedTemplates` and `getShippedTemplate`. `loadShippedTemplates` stays as the synchronous read of the embedded templates.
