import {
  formalizationDocumentRoleReference,
  formalizationStatusMeaningReference,
} from './formalization-readme-reference.js';
import {
  renderFormalizationDocumentRoleReference,
  renderFormalizationStatusMeaningReference,
} from './markdown-reference.js';

export const formalizationReadmeFileName = 'README.md';

export function renderFormalizationReadme(): string {
  const readingOrder = formalizationDocumentRoleReference
    .map((reference, index) => `${index + 1}. \`${reference.fileName}\``)
    .join('\n');

  return `# Runtime Formalization Docs

This folder is the repo-owned documentation set for PR1 workflow runtime formalization.

Read \`000-requirements-ledger.md\` first. It lists what PR1 includes, what is intentionally deferred, and which code owns each concept. Then read \`001\` through \`007\` for the formalization layers, followed by \`008\` and \`009\` for the extension and generation process.

## Target

The target is not to expand the workflow language in this PR. The target is to make the existing minimal workflow path precise, executable, and reviewable:

\`\`\`text
YAML source
  -> SurfaceWorkflowDocument
  -> WorkflowIR
  -> static semantics
  -> runtime transitions
  -> durable execution host
\`\`\`

This documentation set is the repo-owned version of that foundation. Future concepts, including a richer expression language, interpolation, and predicate/premise logic, should enter through the process in \`008-adding-new-concepts.md\` instead of being added directly to runtime code.

## Surface Language Portability

YAML is the only PR1 authoring surface, but the formalization must keep workflow concepts portable to future surfaces such as CUE, TypeScript SDKs, Python SDKs, generated workflows, and UI builders.

Surface-specific parsers should accept syntax and produce Shipfox workflow concepts. They should not define unique runtime semantics. Defaults, inheritance, expression meaning, validation rules, and runtime behavior must be owned by normalization, IR, static semantics, and runtime semantics so equivalent workflows from different surfaces converge before execution.

See \`008-adding-new-concepts.md\` for the detailed rules, examples, and review checklist.

## Architecture Overview

The formalization separates authoring, validation, semantic decisions, and durable effects so each layer has a small responsibility and a clear owner.

| Layer | Purpose | Owner |
| --- | --- | --- |
| YAML surface | Accept the current author-facing workflow syntax and preserve PR1 wire compatibility. | \`@shipfox/api-workflow-language\` |
| CUE formalization artifact | Provide a schema-shaped formal reference for the accepted YAML surface without making CUE an accepted PR1 input language. | \`@shipfox/api-workflow-language\` |
| Expression boundary | Document the minimal current expression representation and the deferred path toward parser, evaluator, interpolation, and predicate/premise logic. | \`@shipfox/api-workflow-language\` |
| WorkflowIR | Normalize authoring syntax into stable, code-owned workflow concepts used by static semantics and runtime semantics. | \`@shipfox/api-workflow-language\` |
| Static semantics | Reject invalid normalized workflows with stable diagnostics before persistence or execution. | \`@shipfox/api-workflow-language\` |
| Pure runtime kernel | Define replayable workflow execution decisions from normalized runtime state and external signals. | \`@shipfox/api-workflows\` |
| Durable execution host | Run the pure kernel reliably through Temporal, activities, workers, persistence, queues, timers, and external side effects. | \`@shipfox/api-workflows\` |

The pure runtime kernel defines workflow semantics. The durable execution host runs those semantics reliably and adapts emitted commands into Temporal child workflows, activities, database writes, runner work, and future external integrations.

This split is intentional:

- It keeps YAML compatibility separate from the internal model Shipfox executes.
- It makes validation deterministic and testable before rows, jobs, or Temporal workflows are created.
- It keeps scheduling semantics pure enough for unit tests and golden traces.
- It keeps Temporal, persistence, outbox, runner, and future integration effects outside the pure kernel.
- It gives future concepts a required path through requirements, surface, IR, diagnostics, runtime semantics, durable execution host changes, generated docs, and tests.

## Status Meanings

${renderFormalizationStatusMeaningReference(formalizationStatusMeaningReference)}

## Document Roles

${renderFormalizationDocumentRoleReference(formalizationDocumentRoleReference)}

## Generated Sections

This README is fully generated, and docs \`000\` through \`009\` contain marker-delimited generated sections. Do not hand-edit generated sections. Update the source-backed metadata in the owning package, run \`turbo generate:docs --filter=@shipfox/api-workflow-language --filter=@shipfox/api-workflows\`, and commit the generated Markdown with the code or doc model change.

\`@shipfox/api-workflow-language\` owns generated docs for the surface, CUE, expression, IR, static-semantics, process, README, and generation layers. \`@shipfox/api-workflows\` owns generated docs for runtime transitions and the durable execution host.

\`010-future-platform-use-cases.md\` is intentionally hand-authored and exploratory. Keep it non-normative unless a future formalization pass promotes a specific concept into the generated process.

## Reading Order

${readingOrder}
`;
}
