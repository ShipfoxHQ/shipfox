export type SurfaceFieldPresence = 'required' | 'optional';

export type SurfaceSchemaFieldReference = Readonly<{
  name: string;
  presence: SurfaceFieldPresence;
  surfaceType: string;
  cueType: string;
  notes: string;
}>;

export type SurfaceSchemaReference = Readonly<{
  typeName: string;
  cueDefinition: string;
  fields: readonly SurfaceSchemaFieldReference[];
}>;

export type SurfaceValidationRuleReference = Readonly<{
  id: string;
  scope: string;
  rule: string;
  source: string;
}>;

export const surfaceSchemaReference: readonly SurfaceSchemaReference[] = [
  {
    typeName: 'SurfaceWorkflowDocument',
    cueDefinition: '#SurfaceWorkflowDocument',
    fields: [
      {
        name: 'name',
        presence: 'required',
        surfaceType: 'non-empty string',
        cueType: 'string & != ""',
        notes: 'Workflow display name and workflow ID source.',
      },
      {
        name: 'triggers',
        presence: 'optional',
        surfaceType: 'map<string, SurfaceTrigger>',
        cueType: '[string]: #Trigger',
        notes: 'Map keyed by trigger name. PR1 does not accept trigger-list authoring.',
      },
      {
        name: 'runner',
        presence: 'optional',
        surfaceType: 'string | string[]',
        cueType: '#StringOrStringList',
        notes: 'Workflow-level runner selector normalized to `RunnerSelectorIR | null`.',
      },
      {
        name: 'jobs',
        presence: 'required',
        surfaceType: 'map<string, SurfaceJob>',
        cueType: '[string]: #Job',
        notes: 'Map keyed by job name. Job keys become source names for diagnostics.',
      },
    ],
  },
  {
    typeName: 'SurfaceTrigger',
    cueDefinition: '#Trigger',
    fields: [
      {
        name: 'source',
        presence: 'required',
        surfaceType: 'string',
        cueType: 'string',
        notes: 'Trigger provider or source name.',
      },
      {
        name: 'event',
        presence: 'optional',
        surfaceType: 'string',
        cueType: 'string',
        notes: '`manual` triggers default this to `fire`; other sources must provide it.',
      },
      {
        name: 'on',
        presence: 'optional',
        surfaceType: 'string | string[]',
        cueType: '#StringOrStringList',
        notes: 'Provider-specific event target filter, normalized to a string list or `null`.',
      },
      {
        name: 'with',
        presence: 'optional',
        surfaceType: 'record<string, unknown>',
        cueType: '{...}',
        notes: 'Provider-specific payload forwarded into trigger IR as structured data.',
      },
      {
        name: 'filter',
        presence: 'optional',
        surfaceType: 'string',
        cueType: 'string',
        notes: 'PR1 preserves the filter string; expression parsing remains deferred.',
      },
    ],
  },
  {
    typeName: 'SurfaceJob',
    cueDefinition: '#Job',
    fields: [
      {
        name: 'needs',
        presence: 'optional',
        surfaceType: 'string | string[]',
        cueType: '#StringOrStringList',
        notes: 'Job dependency references by authored job name.',
      },
      {
        name: 'runner',
        presence: 'optional',
        surfaceType: 'string | string[]',
        cueType: '#StringOrStringList',
        notes: 'Job-level runner selector normalized to `RunnerSelectorIR | null`.',
      },
      {
        name: 'steps',
        presence: 'required',
        surfaceType: 'SurfaceRunStep[] with at least one item',
        cueType: '[#RunStep, ...#RunStep]',
        notes: 'PR1 accepts only run steps.',
      },
    ],
  },
  {
    typeName: 'SurfaceRunStep',
    cueDefinition: '#RunStep',
    fields: [
      {
        name: 'run',
        presence: 'required',
        surfaceType: 'string',
        cueType: 'string',
        notes: 'Shell command executed by the runner.',
      },
      {
        name: 'name',
        presence: 'optional',
        surfaceType: 'string',
        cueType: 'string',
        notes: 'Optional author-facing step name used when deriving stable step IDs.',
      },
    ],
  },
];

export const surfaceValidationRuleReference: readonly SurfaceValidationRuleReference[] = [
  {
    id: 'surface-root-object',
    scope: 'YAML parse result',
    rule: 'The parsed workflow definition must be a YAML object, not `null`, an array, or a scalar.',
    source: 'validateSurfaceWorkflowDocument',
  },
  {
    id: 'surface-name-required',
    scope: 'SurfaceWorkflowDocument.name',
    rule: '`name` must be a non-empty string.',
    source: 'surfaceWorkflowDocumentSchema',
  },
  {
    id: 'surface-jobs-map',
    scope: 'SurfaceWorkflowDocument.jobs',
    rule: '`jobs` must be a map keyed by authored job name.',
    source: 'surfaceWorkflowDocumentSchema',
  },
  {
    id: 'surface-job-steps-required',
    scope: 'SurfaceJob.steps',
    rule: 'Each job must contain at least one run step.',
    source: 'surfaceJobSchema',
  },
  {
    id: 'surface-trigger-event-required',
    scope: 'SurfaceTrigger.event',
    rule: 'Trigger `event` is required unless `source` is `manual`, which defaults to `fire`.',
    source: 'surfaceTriggerSchema',
  },
  {
    id: 'surface-single-manual-trigger',
    scope: 'SurfaceWorkflowDocument.triggers',
    rule: 'A workflow may declare at most one manual trigger.',
    source: 'surfaceWorkflowDocumentSchema',
  },
  {
    id: 'surface-yaml-syntax',
    scope: 'YAML parser',
    rule: 'Invalid YAML syntax is returned as a validation error instead of throwing.',
    source: 'parseYamlSurfaceWorkflowDocument',
  },
];
