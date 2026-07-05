import {getModelProviderEntry} from '@shipfox/api-agent-dto';
import type {AvailabilitySite} from '@shipfox/expression';
import {
  canonicalizeLabels,
  findInvalidLabels,
  MAX_RUNNER_LABEL_LENGTH,
  MAX_RUNNER_LABELS,
  RUNNER_LABEL_PATTERN,
} from '@shipfox/runner-labels';
import type {
  WorkflowDocument,
  WorkflowDocumentJob,
  WorkflowDocumentStep,
} from '@shipfox/workflow-document';
import type {
  WorkflowEnvTemplates,
  WorkflowFieldTemplate,
  WorkflowModelAgentStep,
  WorkflowModelJob,
  WorkflowModelRunStep,
  WorkflowModelStep,
  WorkflowOutputTemplates,
  WorkflowStepSourceLocationMap,
} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {normalizeEnv} from './normalize-env.js';
import {normalizeJobCheckout} from './normalize-job-checkout.js';
import {normalizeJobListening} from './normalize-job-listening.js';
import {normalizeJobSuccess} from './normalize-job-success.js';
import {normalizeNeeds} from './normalize-needs.js';
import {normalizeStepGate} from './normalize-step-gate.js';
import {parseDurationMs} from './parse-duration-ms.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {stableId} from './stable-id.js';
import {issue} from './validation-issue.js';

export function normalizeJobs(
  document: WorkflowDocument,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined,
  defaultRunnerLabels: readonly string[],
): readonly WorkflowModelJob[] {
  return Object.entries(document.jobs).flatMap(([sourceName, job]) => {
    const model = normalizeJob({
      document,
      sourceName,
      job,
      jobIdBySourceName,
      issues,
      stepSourceLocations,
      defaultRunnerLabels,
    });
    return model === undefined ? [] : [model];
  });
}

function normalizeJob(params: {
  document: WorkflowDocument;
  sourceName: string;
  job: WorkflowDocumentJob;
  jobIdBySourceName: ReadonlyMap<string, string>;
  issues: WorkflowModelValidationIssue[];
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  defaultRunnerLabels: readonly string[];
}): WorkflowModelJob | undefined {
  const id = params.jobIdBySourceName.get(params.sourceName);
  if (id === undefined) return undefined;

  const dependencies = normalizeJobDependencies({
    sourceName: params.sourceName,
    job: params.job,
    jobIdBySourceName: params.jobIdBySourceName,
  });
  const allowedJobReferences = directNeedSourceNames({
    sourceName: params.sourceName,
    job: params.job,
    jobIdBySourceName: params.jobIdBySourceName,
  });
  // Step config can reference peer step outputs, which are completed at dispatch.
  const stepFillSite: AvailabilitySite = 'step-dispatch';
  const steps = normalizeJobSteps({
    sourceName: params.sourceName,
    jobId: id,
    job: params.job,
    issues: params.issues,
    stepSourceLocations: params.stepSourceLocations,
    fillSite: stepFillSite,
    allowedJobReferences,
  });
  const runner = normalizeRunner({
    document: params.document,
    job: params.job,
    sourceName: params.sourceName,
    issues: params.issues,
    defaultRunnerLabels: params.defaultRunnerLabels,
  });
  const checkout = normalizeJobCheckout(params.job.checkout);
  const jobEnv = normalizeEnv({
    env: params.job.env,
    path: ['jobs', params.sourceName, 'env'],
    issues: params.issues,
    allowedJobReferences,
  });
  const success = normalizeJobSuccess({
    source: params.job.success,
    sourceName: params.sourceName,
    issues: params.issues,
    allowedJobReferences,
  });
  const outputs = normalizeJobOutputs({
    sourceName: params.sourceName,
    outputs: params.job.outputs,
    issues: params.issues,
    allowedJobReferences,
  });
  const executionTimeoutMs = parseDurationMs({
    source: params.job.execution_timeout,
    path: ['jobs', params.sourceName, 'execution_timeout'],
    issues: params.issues,
  });
  const listening = normalizeJobListening({
    job: params.job,
    sourceName: params.sourceName,
    issues: params.issues,
  });
  const name =
    params.job.name === undefined
      ? undefined
      : (parseInterpolationField({
          field: 'job.name',
          source: params.job.name,
          path: ['jobs', params.sourceName, 'name'],
          issues: params.issues,
          allowedJobReferences,
        }) ?? [{kind: 'literal' as const, value: params.job.name}]);

  return {
    id,
    key: params.sourceName,
    mode: listening === undefined ? 'one_shot' : 'listening',
    runner: runner.labels,
    ...(runner.templates.length === 0 ? {} : {runnerTemplates: runner.templates}),
    checkout,
    ...(success === undefined ? {} : {success}),
    ...(outputs === undefined ? {} : {outputs}),
    ...(executionTimeoutMs === undefined ? {} : {executionTimeoutMs}),
    ...(listening === undefined ? {} : {listening}),
    ...(name === undefined ? {} : {name}),
    ...jobEnv,
    dependencies,
    steps,
  };
}

function normalizeJobDependencies(params: {
  sourceName: string;
  job: WorkflowDocumentJob;
  jobIdBySourceName: ReadonlyMap<string, string>;
}): readonly string[] {
  return normalizeNeeds(params.job.needs).flatMap((dependencySourceName) => {
    const dependencyId = params.jobIdBySourceName.get(dependencySourceName);
    if (dependencyId === undefined || dependencySourceName === params.sourceName) return [];
    return [dependencyId];
  });
}

function directNeedSourceNames(params: {
  sourceName: string;
  job: WorkflowDocumentJob;
  jobIdBySourceName: ReadonlyMap<string, string>;
}): ReadonlySet<string> {
  return new Set(
    normalizeNeeds(params.job.needs).filter(
      (dependencySourceName) =>
        dependencySourceName !== params.sourceName &&
        params.jobIdBySourceName.has(dependencySourceName),
    ),
  );
}

function normalizeJobOutputs(params: {
  sourceName: string;
  outputs: WorkflowDocumentJob['outputs'];
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
}): WorkflowOutputTemplates | undefined {
  if (params.outputs === undefined) return undefined;

  const templates: Record<string, WorkflowFieldTemplate> = Object.create(null) as Record<
    string,
    WorkflowFieldTemplate
  >;
  for (const [key, source] of Object.entries(params.outputs)) {
    templates[key] = parseInterpolationField({
      field: 'job.outputs',
      source,
      path: ['jobs', params.sourceName, 'outputs', key],
      issues: params.issues,
      fillSite: 'execution-resolution',
      allowedJobReferences: params.allowedJobReferences,
    }) ?? [{kind: 'literal' as const, value: source}];
  }

  return templates;
}

function normalizeJobSteps(params: {
  sourceName: string;
  jobId: string;
  job: WorkflowDocumentJob;
  issues: WorkflowModelValidationIssue[];
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
}): readonly WorkflowModelStep[] {
  const usedStepIds = new Map<string, number>();

  return params.job.steps.map((step, index) =>
    normalizeStep({
      step,
      index,
      sourceName: params.sourceName,
      jobId: params.jobId,
      allSteps: params.job.steps,
      usedStepIds,
      issues: params.issues,
      stepSourceLocations: params.stepSourceLocations,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
    }),
  );
}

function normalizeStep(params: {
  step: WorkflowDocumentStep;
  index: number;
  sourceName: string;
  jobId: string;
  allSteps: readonly WorkflowDocumentStep[];
  usedStepIds: Map<string, number>;
  issues: WorkflowModelValidationIssue[];
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
}): WorkflowModelStep {
  const stepKey = params.step.key;
  const stepId =
    stepKey === undefined
      ? `${params.jobId}-step-${params.index + 1}`
      : `${params.jobId}-${stableId(stepKey)}`;
  const existingIndex = params.usedStepIds.get(stepId);

  if (existingIndex !== undefined) {
    params.issues.push(
      issue({
        code: 'duplicate-step-id',
        message: `Steps ${existingIndex} and ${params.index} in job "${params.sourceName}" resolve to the same stable id "${stepId}".`,
        path: ['jobs', params.sourceName, 'steps', params.index],
        details: {id: stepId, indexes: [existingIndex, params.index]},
      }),
    );
  } else {
    params.usedStepIds.set(stepId, params.index);
  }

  const gate = normalizeStepGate({
    step: params.step,
    sourceName: params.sourceName,
    stepIndex: params.index,
    stepId,
    previousStepKeys: new Set(
      params.allSteps
        .slice(0, params.index)
        .flatMap((candidate) => (candidate.key ? [candidate.key] : [])),
    ),
    issues: params.issues,
    allowedJobReferences: params.allowedJobReferences,
  });
  const sourceLocation = params.stepSourceLocations?.get(params.sourceName)?.get(params.index);
  const name =
    params.step.name === undefined
      ? undefined
      : parseInterpolationField({
          field: 'step.name',
          source: params.step.name,
          path: ['jobs', params.sourceName, 'steps', params.index, 'name'],
          issues: params.issues,
          fillSite: params.fillSite,
          allowedJobReferences: params.allowedJobReferences,
        });
  const stepBase = {
    id: stepId,
    ...(stepKey === undefined ? {} : {key: stepKey}),
    ...(params.step.name === undefined ? {} : {name: params.step.name}),
    ...(sourceLocation === undefined ? {} : {sourceLocation}),
    ...(gate === undefined ? {} : {gate}),
  };

  if (params.step.run !== undefined) {
    return normalizeRunStep({
      step: params.step,
      stepBase,
      sourceName: params.sourceName,
      stepIndex: params.index,
      name,
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
    });
  }

  if (params.step.prompt !== undefined) {
    return normalizeAgentStep({
      step: params.step,
      stepBase,
      sourceName: params.sourceName,
      stepIndex: params.index,
      name,
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
    });
  }

  // workflowDocumentStepSchema requires either `run` or an agent `prompt`; this
  // keeps the model-step union honest if callers bypass the document parser.
  throw new Error(`Workflow step "${stepId}" is neither a run nor an agent step`);
}

function normalizeRunStep(params: {
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  name: WorkflowFieldTemplate | undefined;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
}): WorkflowModelRunStep {
  if (params.step.run === undefined) {
    throw new Error('Run step normalization requires a run command');
  }

  const commandTemplate = parseInterpolationField({
    field: 'run',
    source: params.step.run,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'run'],
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
  });
  const stepEnv = normalizeEnv({
    env: params.step.env,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'env'],
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
  });
  const templates = optionalRunStepTemplates({
    command: commandTemplate,
    name: params.name,
    env: stepEnv.templates?.env,
  });

  return {
    ...params.stepBase,
    kind: 'run',
    command: {kind: 'shell', value: params.step.run},
    ...(stepEnv.env === undefined ? {} : {env: stepEnv.env}),
    ...(templates === undefined ? {} : {templates}),
  };
}

function normalizeAgentStep(params: {
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  name: WorkflowFieldTemplate | undefined;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
}): WorkflowModelAgentStep {
  if (params.step.prompt === undefined) {
    throw new Error('Agent step normalization requires a prompt');
  }

  const promptTemplate = parseInterpolationField({
    field: 'agent.prompt',
    source: params.step.prompt,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'prompt'],
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
  });
  const modelTemplate =
    params.step.model === undefined
      ? undefined
      : parseInterpolationField({
          field: 'agent.model',
          source: params.step.model,
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'model'],
          issues: params.issues,
          fillSite: params.fillSite,
          allowedJobReferences: params.allowedJobReferences,
        });
  const providerTemplate =
    params.step.provider === undefined
      ? undefined
      : parseInterpolationField({
          field: 'agent.provider',
          source: params.step.provider,
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'provider'],
          issues: params.issues,
          fillSite: params.fillSite,
          allowedJobReferences: params.allowedJobReferences,
        });
  if (providerTemplate === undefined) {
    validateAgentStep({
      step: params.step,
      sourceName: params.sourceName,
      stepIndex: params.stepIndex,
      issues: params.issues,
    });
  }
  const templates = optionalAgentStepTemplates({
    prompt: promptTemplate,
    model: modelTemplate,
    provider: providerTemplate,
    name: params.name,
  });

  return {
    ...params.stepBase,
    kind: 'agent',
    ...(params.step.harness === undefined ? {} : {harness: params.step.harness}),
    ...(params.step.model === undefined ? {} : {model: params.step.model}),
    ...(params.step.provider === undefined ? {} : {provider: params.step.provider}),
    prompt: params.step.prompt,
    ...(params.step.thinking === undefined ? {} : {thinking: params.step.thinking}),
    ...(templates === undefined ? {} : {templates}),
  };
}

function validateAgentStep(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): void {
  const providerId = params.step.provider;
  if (providerId === undefined) return;

  const provider = getModelProviderEntry(providerId);
  if (provider === undefined || provider.support_status !== 'supported') {
    params.issues.push(
      issue({
        code: 'invalid-provider',
        message: `Provider "${providerId}" is not supported.`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'provider'],
        details: {provider: providerId},
      }),
    );
    return;
  }
}
function normalizeRunner(params: {
  document: WorkflowDocument;
  job: WorkflowDocumentJob;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  defaultRunnerLabels: readonly string[];
}): {labels: readonly string[]; templates: readonly WorkflowFieldTemplate[]} {
  const rawRunner = params.job.runner ?? params.document.runner;
  if (rawRunner === undefined) {
    const runnerLabels = params.defaultRunnerLabels;
    validateRunnerLabels({...params, runnerLabels, allowEmpty: false});
    return {labels: runnerLabels, templates: []};
  }

  const runnerValues = typeof rawRunner === 'string' ? [rawRunner] : rawRunner;
  const literalLabels: string[] = [];
  const templates: WorkflowFieldTemplate[] = [];
  let templateValueCount = 0;
  for (const [index, value] of runnerValues.entries()) {
    const template = parseInterpolationField({
      field: 'job.runner',
      source: value,
      path: ['jobs', params.sourceName, 'runner', index],
      issues: params.issues,
      fillSite: 'execution-creation',
    });
    const hasTemplateSyntax = hasInterpolationSyntax(value);
    if (hasTemplateSyntax) templateValueCount += 1;
    if (template === undefined && !hasTemplateSyntax) {
      literalLabels.push(value);
    } else if (template !== undefined) {
      templates.push(template);
    }
  }

  const runnerLabels = canonicalizeLabels(literalLabels);
  validateRunnerLabels({
    ...params,
    runnerLabels,
    runnerLabelCount: runnerLabels.length + templates.length,
    allowEmpty: templateValueCount > 0,
  });

  return {labels: runnerLabels, templates};
}

function hasInterpolationSyntax(value: string): boolean {
  return value.includes('${{');
}

function validateRunnerLabels(params: {
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  runnerLabels: readonly string[];
  runnerLabelCount?: number;
  allowEmpty: boolean;
}): void {
  const runnerLabels = params.runnerLabels;
  const runnerLabelCount = params.runnerLabelCount ?? runnerLabels.length;
  const invalid = findInvalidLabels(runnerLabels);

  if (invalid.length > 0) {
    params.issues.push(
      issue({
        code: 'invalid-runner-label',
        message: `Job "${params.sourceName}" has invalid runner label(s): ${invalid.join(', ')}. Labels must match ${RUNNER_LABEL_PATTERN} and be at most ${MAX_RUNNER_LABEL_LENGTH} chars.`,
        path: ['jobs', params.sourceName, 'runner'],
        details: {labels: invalid},
      }),
    );
  }

  if (runnerLabels.length === 0 && !params.allowEmpty) {
    params.issues.push(
      issue({
        code: 'missing-runner-label',
        message: `Job "${params.sourceName}" must declare at least one runner label. Set "runner" on the job or the workflow, or configure DEFINITION_DEFAULT_RUNNER_LABEL.`,
        path: ['jobs', params.sourceName, 'runner'],
      }),
    );
  }

  if (runnerLabelCount > MAX_RUNNER_LABELS) {
    params.issues.push(
      issue({
        code: 'too-many-runner-labels',
        message: `Job "${params.sourceName}" declares ${runnerLabelCount} runner labels; the maximum is ${MAX_RUNNER_LABELS}.`,
        path: ['jobs', params.sourceName, 'runner'],
      }),
    );
  }
}

type WorkflowModelStepBaseFields = Pick<
  WorkflowModelStep,
  'id' | 'key' | 'name' | 'sourceLocation' | 'gate'
>;

function optionalRunStepTemplates(params: {
  command: WorkflowFieldTemplate | undefined;
  name: WorkflowFieldTemplate | undefined;
  env: WorkflowEnvTemplates | undefined;
}):
  | {
      command?: WorkflowFieldTemplate;
      name?: WorkflowFieldTemplate;
      env?: WorkflowEnvTemplates;
    }
  | undefined {
  if (params.command === undefined && params.name === undefined && params.env === undefined) {
    return undefined;
  }

  return {
    ...(params.command === undefined ? {} : {command: params.command}),
    ...(params.name === undefined ? {} : {name: params.name}),
    ...(params.env === undefined ? {} : {env: params.env}),
  };
}

function optionalAgentStepTemplates(params: {
  prompt: WorkflowFieldTemplate | undefined;
  model: WorkflowFieldTemplate | undefined;
  provider: WorkflowFieldTemplate | undefined;
  name: WorkflowFieldTemplate | undefined;
}):
  | {
      prompt?: WorkflowFieldTemplate;
      model?: WorkflowFieldTemplate;
      provider?: WorkflowFieldTemplate;
      name?: WorkflowFieldTemplate;
    }
  | undefined {
  if (
    params.prompt === undefined &&
    params.model === undefined &&
    params.provider === undefined &&
    params.name === undefined
  ) {
    return undefined;
  }

  return {
    ...(params.prompt === undefined ? {} : {prompt: params.prompt}),
    ...(params.model === undefined ? {} : {model: params.model}),
    ...(params.provider === undefined ? {} : {provider: params.provider}),
    ...(params.name === undefined ? {} : {name: params.name}),
  };
}
