export type RequirementPr1Status = 'Included' | 'Deferred';

export type RequirementStatusReference = Readonly<{
  requirement: string;
  pr1Status: RequirementPr1Status;
  primaryDocs: readonly string[];
  primaryCode: readonly string[];
}>;

export type ConceptChangeChecklistReference = Readonly<{
  step: number;
  layer: string;
  action: string;
  requiredArtifacts: string;
  expectedTests: string;
  generatedDocsImpact: string;
}>;

export type DocGenerationCapabilityReference = Readonly<{
  capability: string;
  owners: readonly string[];
  inputs: string;
  outputDocs: readonly string[];
  tests: readonly string[];
}>;

export const requirementStatusReference: readonly RequirementStatusReference[] = [
  {
    requirement: 'Preserve current YAML surface and public wire names',
    pr1Status: 'Included',
    primaryDocs: ['001-yaml-surface.md'],
    primaryCode: ['libs/api/definitions-dto', 'libs/api/definitions'],
  },
  {
    requirement: 'Rename TypeScript surface concepts away from `WorkflowSpec`',
    pr1Status: 'Included',
    primaryDocs: ['001-yaml-surface.md'],
    primaryCode: ['libs/api/workflow-language/src/core/surface'],
  },
  {
    requirement: 'Provide a CUE formalization artifact without accepting CUE input',
    pr1Status: 'Included',
    primaryDocs: ['002-cue-schema.md'],
    primaryCode: ['libs/api/workflow-language/src/core/surface/surface-workflow-document-cue.ts'],
  },
  {
    requirement: 'Normalize YAML surface documents into `WorkflowIR`',
    pr1Status: 'Included',
    primaryDocs: ['004-core-ir.md'],
    primaryCode: ['libs/api/workflow-language/src/core/ir'],
  },
  {
    requirement: 'Reuse static semantics for validation and run creation',
    pr1Status: 'Included',
    primaryDocs: ['005-static-semantics.md'],
    primaryCode: [
      'libs/api/workflow-language/src/core/static-semantics',
      'libs/api/definitions',
      'libs/api/workflows',
    ],
  },
  {
    requirement: 'Create workflow runs from normalized IR',
    pr1Status: 'Included',
    primaryDocs: ['004-core-ir.md', '005-static-semantics.md'],
    primaryCode: [
      'libs/api/workflows/src/core/run-workflow.ts',
      'libs/api/workflows/src/db/workflow-runs.ts',
    ],
  },
  {
    requirement: 'Formalize job-level runtime transitions with golden traces',
    pr1Status: 'Included',
    primaryDocs: ['006-runtime-transitions.md'],
    primaryCode: ['libs/api/workflows/src/core/runtime'],
  },
  {
    requirement: 'Delegate Temporal scheduling decisions to the runtime kernel',
    pr1Status: 'Included',
    primaryDocs: ['007-durable-execution-host.md'],
    primaryCode: ['libs/api/workflows/src/temporal/workflows/run-orchestration.ts'],
  },
  {
    requirement: 'Define process for new formalized concepts',
    pr1Status: 'Included',
    primaryDocs: ['008-adding-new-concepts.md'],
    primaryCode: ['libs/api/workflow-language/src/docs/formalization-process-reference.ts'],
  },
  {
    requirement: 'Document generated-doc workflow',
    pr1Status: 'Included',
    primaryDocs: ['009-doc-generation.md'],
    primaryCode: ['libs/api/workflow-language/scripts/generate-formalization-docs.ts'],
  },
  {
    requirement: 'Public wire rename from `definition` to `document`',
    pr1Status: 'Deferred',
    primaryDocs: ['001-yaml-surface.md'],
    primaryCode: ['deferred'],
  },
  {
    requirement: 'CUE as an accepted authoring surface',
    pr1Status: 'Deferred',
    primaryDocs: ['002-cue-schema.md'],
    primaryCode: ['deferred'],
  },
  {
    requirement: 'Custom expression parser and `gate.success_if` evaluation',
    pr1Status: 'Deferred',
    primaryDocs: ['003-expression-language.md'],
    primaryCode: ['deferred'],
  },
  {
    requirement: 'Cached WorkflowIR persistence',
    pr1Status: 'Deferred',
    primaryDocs: ['004-core-ir.md'],
    primaryCode: ['deferred'],
  },
  {
    requirement: 'Runtime state snapshots',
    pr1Status: 'Deferred',
    primaryDocs: ['006-runtime-transitions.md', '007-durable-execution-host.md'],
    primaryCode: ['deferred'],
  },
  {
    requirement: 'Step-level runtime transitions',
    pr1Status: 'Deferred',
    primaryDocs: ['006-runtime-transitions.md'],
    primaryCode: ['deferred'],
  },
  {
    requirement: 'Pipelined child workflow scheduling across sibling branches',
    pr1Status: 'Deferred',
    primaryDocs: ['007-durable-execution-host.md'],
    primaryCode: ['deferred'],
  },
];

export const conceptChangeChecklistReference: readonly ConceptChangeChecklistReference[] = [
  {
    step: 1,
    layer: 'Requirement',
    action: 'Add or update the ledger row before code changes.',
    requiredArtifacts: '`000-requirements-ledger.md` row',
    expectedTests: 'None unless generated metadata changes.',
    generatedDocsImpact: 'Regenerate `000-requirements-ledger.md`.',
  },
  {
    step: 2,
    layer: 'Classification',
    action:
      'Classify the change as surface-only, semantic/static, runtime-stateful, adapter-only, or a combination.',
    requiredArtifacts: 'Decision in the affected formalization doc',
    expectedTests: 'Review-only unless classification changes behavior.',
    generatedDocsImpact: 'Update process docs if a new layer appears.',
  },
  {
    step: 3,
    layer: 'Surface',
    action: 'Update YAML/Zod schemas and parser behavior when authoring shape changes.',
    requiredArtifacts: 'Surface schema, YAML parser, compatibility notes',
    expectedTests: 'Parser/schema tests and compatibility tests.',
    generatedDocsImpact:
      'Regenerate `001-yaml-surface.md` and `002-cue-schema.md` when shape changes.',
  },
  {
    step: 4,
    layer: 'Expression',
    action:
      'Add grammar, parser, typed AST, static diagnostics, and evaluator before accepting expression strings.',
    requiredArtifacts: 'Expression IR, parser, diagnostics, fact model',
    expectedTests: 'Parser, typecheck, diagnostic, evaluator, and trace tests as applicable.',
    generatedDocsImpact: 'Regenerate `003-expression-language.md`.',
  },
  {
    step: 5,
    layer: 'IR',
    action: 'Normalize the concept into `WorkflowIR`, or document why it normalizes away.',
    requiredArtifacts: 'IR types and normalizer behavior',
    expectedTests: 'Normalizer tests and generated type-reference checks.',
    generatedDocsImpact: 'Regenerate `004-core-ir.md`.',
  },
  {
    step: 6,
    layer: 'Static semantics',
    action: 'Add stable diagnostics for invalid cross-field or graph states.',
    requiredArtifacts: 'Diagnostic ID, message, path shape, validation rule',
    expectedTests: 'Diagnostic coverage and validator-backed drift tests.',
    generatedDocsImpact: 'Regenerate `005-static-semantics.md`.',
  },
  {
    step: 7,
    layer: 'Runtime',
    action:
      'Add runtime events, commands, state fields, transition rules, and golden traces only when behavior changes.',
    requiredArtifacts: 'Pure transition kernel updates and trace registry',
    expectedTests: 'Transition unit tests and golden trace tests.',
    generatedDocsImpact: 'Regenerate `006-runtime-transitions.md`.',
  },
  {
    step: 8,
    layer: 'Durable execution host',
    action:
      'Update Temporal, persistence, outbox, runner, or trigger adapters only for side effects the pure model cannot own.',
    requiredArtifacts: 'Adapter map and execution-host behavior',
    expectedTests: 'Workflow/activity tests and adapter coverage tests.',
    generatedDocsImpact: 'Regenerate `007-durable-execution-host.md`.',
  },
  {
    step: 9,
    layer: 'Docs and tests',
    action:
      'Update generated docs, examples, and the smallest affected validation commands before broader checks.',
    requiredArtifacts: 'Doc model, generated Markdown, committed-output test',
    expectedTests: 'Package tests, typecheck, check, then affected build/test/check before commit.',
    generatedDocsImpact: 'Regenerate every affected formalization doc.',
  },
  {
    step: 10,
    layer: 'Deferrals',
    action: 'Document deliberately postponed work with enough context to execute later.',
    requiredArtifacts: 'Deferred section in the relevant repo doc',
    expectedTests: 'Review-only unless deferral changes generated metadata.',
    generatedDocsImpact: 'Regenerate affected docs when deferred metadata is generated.',
  },
];

export const docGenerationCapabilityReference: readonly DocGenerationCapabilityReference[] = [
  {
    capability: 'Formalization doc model renderer',
    owners: ['libs/api/workflow-language/src/docs/formalization-doc-model.ts'],
    inputs:
      'Structured doc model, workflow-language source-backed metadata, TypeScript source snippets',
    outputDocs: [
      '000-requirements-ledger.md',
      '001-yaml-surface.md',
      '002-cue-schema.md',
      '003-expression-language.md',
      '004-core-ir.md',
      '005-static-semantics.md',
      '008-adding-new-concepts.md',
      '009-doc-generation.md',
    ],
    tests: ['libs/api/workflow-language/src/docs/formalization-doc-model.test.ts'],
  },
  {
    capability: 'Runtime formalization doc renderer',
    owners: [
      'libs/api/workflows/scripts/generate-formalization-docs.ts',
      'libs/api/workflows/src/docs/runtime-formalization-doc-model.ts',
    ],
    inputs: 'Workflows-owned runtime and durable execution host metadata',
    outputDocs: ['006-runtime-transitions.md', '007-durable-execution-host.md'],
    tests: ['libs/api/workflows/src/docs/runtime-formalization-doc-model.test.ts'],
  },
  {
    capability: 'Formalization README renderer',
    owners: [
      'libs/api/workflow-language/src/docs/formalization-readme-model.ts',
      'libs/api/workflow-language/src/docs/formalization-readme-reference.ts',
    ],
    inputs: 'Status meanings, document roles, generated-doc statuses',
    outputDocs: ['README.md'],
    tests: [
      'libs/api/workflow-language/src/docs/formalization-doc-model.test.ts',
      'libs/api/workflow-language/src/docs/formalization-readme-reference.test.ts',
    ],
  },
  {
    capability: 'Markdown reference renderers',
    owners: ['libs/api/workflow-language/src/docs/markdown-reference.ts'],
    inputs: 'Source-backed reference metadata rows',
    outputDocs: [
      'README.md',
      '000-requirements-ledger.md',
      '001-yaml-surface.md',
      '002-cue-schema.md',
      '003-expression-language.md',
      '004-core-ir.md',
      '005-static-semantics.md',
      '008-adding-new-concepts.md',
      '009-doc-generation.md',
    ],
    tests: ['libs/api/workflow-language/src/docs/formalization-doc-model.test.ts'],
  },
  {
    capability: 'Surface schema and CUE references',
    owners: [
      'libs/api/workflow-language/src/core/surface/surface-schema-reference.ts',
      'libs/api/workflow-language/src/core/surface/surface-workflow-document-cue.ts',
    ],
    inputs: 'Surface schema reference metadata and PR1 CUE artifact',
    outputDocs: ['001-yaml-surface.md', '002-cue-schema.md'],
    tests: [
      'libs/api/workflow-language/src/core/surface/surface-schema-reference.test.ts',
      'libs/api/workflow-language/src/core/surface/surface-workflow-document-cue.test.ts',
    ],
  },
  {
    capability: 'Expression language references',
    owners: ['libs/api/workflow-language/src/core/ir/expression-language-reference.ts'],
    inputs: 'Default acceptance policy and expression support metadata',
    outputDocs: ['003-expression-language.md'],
    tests: [
      'libs/api/workflow-language/src/core/ir/expression-language-reference.test.ts',
      'libs/api/workflow-language/src/docs/formalization-doc-model.test.ts',
    ],
  },
  {
    capability: 'IR normalization references',
    owners: ['libs/api/workflow-language/src/core/ir/normalization-reference.ts'],
    inputs: 'ID helper examples and explicit normalizer rule metadata',
    outputDocs: ['004-core-ir.md'],
    tests: [
      'libs/api/workflow-language/src/core/ir/normalization-reference.test.ts',
      'libs/api/workflow-language/src/docs/formalization-doc-model.test.ts',
    ],
  },
  {
    capability: 'Type reference extraction',
    owners: ['libs/api/workflow-language/src/docs/typescript-type-reference.ts'],
    inputs: 'Exported TypeScript types from selected source files',
    outputDocs: ['003-expression-language.md', '004-core-ir.md'],
    tests: [
      'libs/api/workflow-language/src/docs/typescript-type-reference.test.ts',
      'libs/api/workflow-language/src/docs/formalization-doc-model.test.ts',
    ],
  },
  {
    capability: 'Static diagnostic references',
    owners: ['libs/api/workflow-language/src/core/static-semantics/static-diagnostic-reference.ts'],
    inputs: 'Static diagnostic IDs, examples, path shapes, and validation metadata',
    outputDocs: ['005-static-semantics.md'],
    tests: [
      'libs/api/workflow-language/src/core/static-semantics/static-diagnostic-reference.test.ts',
    ],
  },
  {
    capability: 'Process and generation references',
    owners: ['libs/api/workflow-language/src/docs/formalization-process-reference.ts'],
    inputs: 'Requirement ledger, concept checklist, and generator capability metadata',
    outputDocs: [
      '000-requirements-ledger.md',
      '008-adding-new-concepts.md',
      '009-doc-generation.md',
    ],
    tests: [
      'libs/api/workflow-language/src/docs/formalization-process-reference.test.ts',
      'libs/api/workflow-language/src/docs/formalization-doc-model.test.ts',
    ],
  },
];
