export type FormalizationReadmeDocStatus = 'normative' | 'deferred' | 'exploratory';

export type FormalizationStatusMeaningReference = Readonly<{
  status: FormalizationReadmeDocStatus;
  meaning: string;
}>;

export type FormalizationDocumentRoleReference = Readonly<{
  fileName: string;
  status: FormalizationReadmeDocStatus;
  generated: boolean;
  generatorOwner: string;
  role: string;
}>;

export const formalizationStatusMeaningReference: readonly FormalizationStatusMeaningReference[] = [
  {
    status: 'normative',
    meaning: 'Describes committed PR1 behavior or the committed process for extending it.',
  },
  {
    status: 'deferred',
    meaning: 'Documents a concept that PR1 intentionally does not implement.',
  },
  {
    status: 'exploratory',
    meaning:
      'Captures future product or platform examples. Exploratory YAML snippets are not accepted PR1 syntax unless another normative document says so.',
  },
];

export const formalizationDocumentRoleReference: readonly FormalizationDocumentRoleReference[] = [
  {
    fileName: '000-requirements-ledger.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflow-language',
    role: 'Review ledger for included and deferred formalization requirements.',
  },
  {
    fileName: '001-yaml-surface.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflow-language',
    role: 'Author-facing YAML surface and compatibility constraints.',
  },
  {
    fileName: '002-cue-schema.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflow-language',
    role: 'CUE formalization artifact for the parsed surface shape; not an accepted input format in PR1.',
  },
  {
    fileName: '003-expression-language.md',
    status: 'deferred',
    generated: true,
    generatorOwner: '@shipfox/api-workflow-language',
    role: 'Current minimal expression IR and the deferred path toward parser, typechecker, evaluator, interpolation, and predicate/premise logic.',
  },
  {
    fileName: '004-core-ir.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflow-language',
    role: 'Normalized workflow model consumed by static checks and runtime semantics.',
  },
  {
    fileName: '005-static-semantics.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflow-language',
    role: 'Stable diagnostics over normalized `WorkflowIR`.',
  },
  {
    fileName: '006-runtime-transitions.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflows',
    role: 'Pure job-level transition kernel and golden trace ownership.',
  },
  {
    fileName: '007-durable-execution-host.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflows',
    role: 'Temporal and persistence adapter responsibilities around the pure runtime kernel.',
  },
  {
    fileName: '008-adding-new-concepts.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflow-language',
    role: 'Process for extending the formalized language/runtime without bypassing required layers.',
  },
  {
    fileName: '009-doc-generation.md',
    status: 'normative',
    generated: true,
    generatorOwner: '@shipfox/api-workflow-language',
    role: 'How generated documentation is produced, tested, reviewed, and committed.',
  },
  {
    fileName: '010-future-platform-use-cases.md',
    status: 'exploratory',
    generated: false,
    generatorOwner: 'hand-authored',
    role: 'Non-normative examples that can motivate later formalization work.',
  },
];
