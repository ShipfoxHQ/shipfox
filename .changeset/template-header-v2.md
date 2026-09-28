---
"@shipfox/workflow-templates": minor
---

Adds the registry form of the `# shipfox-template:` header, `# shipfox-template: <namespace>/<name>@<version>; roles: <role>=<provider> ...; options: <option>=<choice> ...`. `parseTemplateHeader` reads both the registry and legacy forms without the manifest, from the header line or a whole workflow. It is also exported from the browser-safe `@shipfox/workflow-templates/header` subpath, with `formatTemplateHeader`. `composeTemplate` takes a third argument with `options` and a `header` choice, `{kind: 'legacy'}` (the default) or `{kind: 'registry', reference}`. `applyTemplateOptions` keeps the blocks of each chosen `# option:X=Y`, deletes that option's other blocks, and removes their marker lines. An option with no chosen value is left unchanged. Composed output is unchanged unless a caller asks for the registry header.
