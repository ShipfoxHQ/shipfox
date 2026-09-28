---
"@shipfox/workflow-document": minor
---

Action steps can reference a registry version, such as `uses: shipfox/slack-thread-digest@1.4.2`. Registry references stay off by default.

- **Opt-in:** `parseWorkflowDocument(input, {actions: true, registryActions: true})` accepts registry references. Without `registryActions`, every registry form still fails with "Remote actions are not supported yet". `workflowDocumentStepSchema` used directly accepts them.
- **Grammar:** a reference is `namespace/name@MAJOR.MINOR.PATCH`. Namespaces and names are 2 to 40 lowercase letters, digits, and single hyphens. Ranges, tags, pre-release versions, and bare names fail with "Pin an exact version". A host such as `registry.acme.dev/...` fails with "Other registries are not supported yet", and `owner/repo/path@ref` fails with "Remote actions come from the registry, not from Git". Repository path forms keep their messages.
- **Parsed reference:** `parseWorkflowActionRef(uses)` returns `{kind: 'local', path}` or `{kind: 'registry', namespace, name, version}`, or the message for an invalid value.
- **Manifest:** `action.yml` accepts optional `keywords` (up to 10 slugs) and `related` (registry package names).
