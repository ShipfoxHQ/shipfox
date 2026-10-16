import {
  DEFAULT_JOB_CHECKOUT,
  type WorkflowJsonTemplateTree,
  type WorkflowJsonValue,
  type WorkflowModel,
  type WorkflowModelAction,
  type WorkflowModelActionInput,
} from '@shipfox/api-definitions-dto';
import {
  createWorkflowExpression,
  type OutputDeclarations,
  type OutputTypeDeclaration,
  parseWorkflowTemplate,
  planInterpolationField,
  type ResolvedFieldSegment,
  type WorkflowInterpolationField,
} from '@shipfox/expression';

type ModelStep = WorkflowModel['jobs'][number]['steps'][number];
type AgentThinking = Extract<ModelStep, {kind: 'agent'}>['thinking'];
type AgentToolSurface = Extract<ModelStep, {kind: 'agent'}>['toolSurface'];
type Harness = Extract<ModelStep, {kind: 'agent'}>['harness'];
type Checkout = Extract<ModelStep, {kind: 'checkout'}>['checkout'];
type WorkflowEnvTemplates = NonNullable<NonNullable<WorkflowModel['templates']>['env']>;

interface TestWorkflowStepBase {
  readonly key?: string | undefined;
  readonly name?: string | undefined;
  readonly workingDirectory?: string | undefined;
  readonly sourceLocation?: WorkflowModel['jobs'][number]['steps'][number]['sourceLocation'];
  readonly if?: ModelStep['if'] | undefined;
  readonly runAfter?: ModelStep['runAfter'] | undefined;
  readonly gate?: WorkflowModel['jobs'][number]['steps'][number]['gate'] | undefined;
}

interface TestRunStep extends TestWorkflowStepBase {
  readonly run: string;
  readonly env?: WorkflowModel['env'] | undefined;
  readonly outputs?: OutputDeclarations | undefined;
}

interface TestAgentStep extends TestWorkflowStepBase {
  readonly harness?: Harness | undefined;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly prompt: string;
  readonly thinking?: AgentThinking | undefined;
  readonly tools?: readonly string[] | undefined;
  readonly toolSurface?: AgentToolSurface | undefined;
  readonly integrations?: Extract<ModelStep, {kind: 'agent'}>['integrations'] | undefined;
  readonly mcpServers?: Readonly<Record<string, TestAgentMcpServer>> | undefined;
  readonly session?: string | {key: string; mode?: 'resume' | 'fork'} | undefined;
  readonly repositoryContext?: Extract<ModelStep, {kind: 'agent'}>['repositoryContext'] | undefined;
}

export type TestAgentMcpServer =
  | {
      readonly command: string;
      readonly args?: readonly string[] | undefined;
      readonly env?: Readonly<Record<string, string>> | undefined;
      readonly include?: readonly string[] | undefined;
    }
  | {
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>> | undefined;
      readonly include?: readonly string[] | undefined;
    };

interface TestCheckoutStep extends TestWorkflowStepBase {
  readonly checkout: Checkout;
}

interface TestToolStep extends TestWorkflowStepBase {
  readonly tool: string;
  readonly connection?: string | undefined;
  readonly with?: WorkflowJsonValue | undefined;
  readonly outputs?: Readonly<Record<string, string>> | undefined;
}

interface TestActionStep extends TestWorkflowStepBase {
  readonly uses: string;
  readonly action?: Partial<Omit<WorkflowModelAction, 'uses'>> | undefined;
  readonly with?: WorkflowJsonValue | undefined;
  readonly env?: WorkflowModel['env'] | undefined;
  readonly outputs?: OutputDeclarations | undefined;
}

interface TestCompositeStep extends TestWorkflowStepBase {
  readonly uses: string;
  readonly composite?:
    | {
        readonly name?: string | undefined;
        readonly digest?: string | undefined;
        readonly inputs?: Readonly<Record<string, WorkflowModelActionInput>> | undefined;
        /** Each output's type and its `value` source. */
        readonly outputs?:
          | Readonly<
              Record<string, {readonly type: OutputTypeDeclaration['type']; readonly value: string}>
            >
          | undefined;
      }
    | undefined;
  readonly with?: WorkflowJsonValue | undefined;
  readonly env?: WorkflowModel['env'] | undefined;
  readonly steps: readonly TestWorkflowStep[];
}

export type TestWorkflowStep =
  | TestRunStep
  | TestAgentStep
  | TestCheckoutStep
  | TestToolStep
  | TestActionStep
  | TestCompositeStep;

export const TEST_COMPOSITE_DIGEST = `sha256:${'c'.repeat(64)}`;

const DEFAULT_RUNNER_LABELS = ['ubuntu-latest'] as const;

export type TestJobContainer =
  | string
  | {
      readonly image: string;
      readonly credentials?: {readonly username: string; readonly password: string} | undefined;
      readonly env?: Readonly<Record<string, string>> | undefined;
      readonly options?: string | undefined;
      readonly dockerSocket?: boolean | undefined;
    };

interface TestWorkflowJob {
  readonly needs?: string | readonly string[] | undefined;
  readonly name?: string | undefined;
  readonly executionName?: string | undefined;
  readonly runner?: string | readonly string[] | undefined;
  readonly runnerTemplates?: readonly string[] | undefined;
  readonly checkout?: WorkflowModel['jobs'][number]['checkout'] | undefined;
  readonly container?: TestJobContainer | undefined;
  readonly if?: string | undefined;
  readonly runAfter?: WorkflowModel['jobs'][number]['runAfter'] | undefined;
  readonly success?: string | undefined;
  readonly outputs?: Readonly<Record<string, string>> | undefined;
  readonly outputTypes?: WorkflowModel['jobs'][number]['outputTypes'] | undefined;
  readonly exportedOutputs?: WorkflowModel['jobs'][number]['exportedOutputs'] | undefined;
  readonly env?: WorkflowModel['env'] | undefined;
  readonly listening?: WorkflowModel['jobs'][number]['listening'] | undefined;
  readonly steps: readonly TestWorkflowStep[];
}

interface TestWorkflowModelInput {
  readonly name?: string | undefined;
  readonly runName?: string | undefined;
  readonly concurrency?:
    | {
        readonly group: string;
        readonly scope?: 'workflow' | 'project' | undefined;
        readonly cancelInProgress?: boolean | undefined;
      }
    | undefined;
  readonly runner?: string | readonly string[] | undefined;
  readonly env?: WorkflowModel['env'] | undefined;
  readonly jobs?: Readonly<Record<string, TestWorkflowJob>> | undefined;
  readonly outputs?: Readonly<Record<string, string>> | undefined;
  readonly outputTypes?: WorkflowModel['outputTypes'] | undefined;
}

export function workflowModel(input: TestWorkflowModelInput = {}): WorkflowModel {
  const jobs = input.jobs ?? {
    build: {
      steps: [{run: 'echo hello'}],
    },
  };
  const modelJobs = Object.entries(jobs).map(([key, job]) => normalizeJob(key, job, input.runner));

  return {
    kind: 'workflow',
    name: input.name ?? 'Test Workflow',
    ...(input.runName === undefined
      ? {}
      : {
          runName: fieldTemplate('workflow.run_name', input.runName) ?? [
            {kind: 'literal' as const, value: input.runName},
          ],
        }),
    ...(input.concurrency === undefined
      ? {}
      : {
          concurrency: {
            group: fieldTemplate('workflow.run_name', input.concurrency.group) ?? [
              {kind: 'literal' as const, value: input.concurrency.group},
            ],
            scope: input.concurrency.scope ?? 'workflow',
            cancelInProgress: input.concurrency.cancelInProgress ?? false,
          },
        }),
    ...optionalScopedEnv(input.env),
    triggers: [],
    jobs: modelJobs,
    dependencies: modelJobs.flatMap((job) =>
      job.dependencies.map((dependency) => ({from: dependency, to: job.id})),
    ),
    ...(input.outputs === undefined
      ? {}
      : {outputs: outputTemplates(input.outputs, 'workflow.outputs')}),
    ...(input.outputTypes === undefined ? {} : {outputTypes: input.outputTypes}),
  };
}

function normalizeJob(
  key: string,
  job: TestWorkflowJob,
  workflowRunner: TestWorkflowModelInput['runner'],
): WorkflowModel['jobs'][number] {
  const jobId = stableId(key);
  return {
    id: jobId,
    key,
    mode: job.listening === undefined ? 'one_shot' : 'listening',
    runner: normalizeStringArray(job.runner ?? workflowRunner ?? DEFAULT_RUNNER_LABELS),
    ...(job.runnerTemplates === undefined
      ? {}
      : {
          runnerTemplates: job.runnerTemplates.map((template) =>
            requiredFieldTemplate('job.runner', template),
          ),
        }),
    checkout: job.checkout ?? DEFAULT_JOB_CHECKOUT,
    ...(job.container === undefined ? {} : {container: normalizeContainer(job.container)}),
    ...(job.if === undefined ? {} : {if: workflowExpression(job.if)}),
    ...(job.runAfter === undefined ? {} : {runAfter: job.runAfter}),
    ...(job.success === undefined ? {} : {success: job.success}),
    ...(job.outputs === undefined ? {} : {outputs: outputTemplates(job.outputs, 'job.outputs')}),
    ...(job.outputTypes === undefined ? {} : {outputTypes: job.outputTypes}),
    ...(job.exportedOutputs === undefined ? {} : {exportedOutputs: job.exportedOutputs}),
    ...(job.name === undefined ? {} : {name: job.name}),
    ...(job.executionName === undefined
      ? {}
      : {
          executionName: fieldTemplate('job.execution_name', job.executionName) ?? [
            {kind: 'literal' as const, value: job.executionName},
          ],
        }),
    ...(job.listening === undefined ? {} : {listening: job.listening}),
    ...optionalScopedEnv(job.env),
    dependencies: normalizeStringArray(job.needs).map(stableId),
    steps: job.steps.map((step, stepIndex) => normalizeStep(step, jobId, stepIndex)),
  };
}

function normalizeContainer(
  container: TestJobContainer,
): NonNullable<WorkflowModel['jobs'][number]['container']> {
  const {image, credentials, env, options, dockerSocket} =
    typeof container === 'string' ? {image: container} : container;
  const envTemplate = Object.fromEntries(
    Object.entries(env ?? {}).flatMap(([key, value]) => {
      const template = fieldTemplate('job.container.env.value', value);
      return template === undefined ? [] : [[key, template]];
    }),
  );
  const templates = {
    ...optionalTemplate('image', fieldTemplate('job.container.image', image)),
    ...optionalTemplate(
      'options',
      options === undefined ? undefined : fieldTemplate('job.container.options', options),
    ),
    ...optionalTemplate(
      'username',
      credentials === undefined
        ? undefined
        : fieldTemplate('job.container.credentials', credentials.username),
    ),
    ...optionalTemplate(
      'password',
      credentials === undefined
        ? undefined
        : fieldTemplate('job.container.credentials', credentials.password),
    ),
    ...(Object.keys(envTemplate).length === 0 ? {} : {env: envTemplate}),
  };
  return {
    image,
    ...(credentials === undefined ? {} : {credentials}),
    ...(env === undefined ? {} : {env}),
    ...(options === undefined ? {} : {options}),
    dockerSocket: dockerSocket ?? true,
    ...(Object.keys(templates).length === 0 ? {} : {templates}),
  };
}

function optionalTemplate<Key extends string>(
  key: Key,
  template: readonly ResolvedFieldSegment[] | undefined,
): {[Name in Key]?: readonly ResolvedFieldSegment[]} {
  return template === undefined ? {} : ({[key]: template} as {[Name in Key]: typeof template});
}

function workflowExpression(source: string) {
  return createWorkflowExpression({
    source,
    check: {mode: 'syntax'},
  });
}

function outputTemplates(
  outputs: Readonly<Record<string, string>>,
  field: 'job.outputs' | 'workflow.outputs',
) {
  return Object.fromEntries(
    Object.entries(outputs).map(([key, source]) => [
      key,
      fieldTemplate(field, source) ?? [{kind: 'literal' as const, value: source}],
    ]),
  );
}

function normalizeStep(
  step: TestWorkflowStep,
  jobId: string,
  stepIndex: number,
  parentId?: string,
): ModelStep {
  const base = stepBase(step, jobId, stepIndex, parentId);
  if ('steps' in step) return normalizeCompositeStep(step, jobId, base);
  if ('run' in step) return normalizeRunStep(step, base);
  if ('prompt' in step) return normalizeAgentStep(step, base);
  if ('tool' in step) return normalizeToolStep(step, base);
  if ('uses' in step) return normalizeActionStep(step, base);
  return {...base, kind: 'checkout', checkout: step.checkout};
}

function normalizeRunStep(step: TestRunStep, base: ReturnType<typeof stepBase>): ModelStep {
  return {
    ...base,
    kind: 'run',
    command: {kind: 'shell', value: step.run},
    ...optionalRunTemplates(step),
    ...optionalStepEnv(step.env),
    ...(step.outputs === undefined ? {} : {outputs: step.outputs}),
  };
}

function normalizeAgentStep(step: TestAgentStep, base: ReturnType<typeof stepBase>): ModelStep {
  return {
    ...base,
    kind: 'agent',
    ...(step.harness === undefined ? {} : {harness: step.harness}),
    ...(step.model === undefined ? {} : {model: step.model}),
    ...(step.provider === undefined ? {} : {provider: step.provider}),
    ...(step.thinking === undefined ? {} : {thinking: step.thinking}),
    ...(step.tools === undefined ? {} : {tools: step.tools}),
    ...(step.toolSurface === undefined ? {} : {toolSurface: step.toolSurface}),
    ...(step.integrations === undefined ? {} : {integrations: step.integrations}),
    ...(step.mcpServers === undefined
      ? {}
      : {customMcpServers: Object.entries(step.mcpServers).map(normalizeMcpServer)}),
    ...(step.session === undefined ? {} : {session: testAgentStepSession(step.session)}),
    ...(step.repositoryContext === undefined ? {} : {repositoryContext: step.repositoryContext}),
    prompt: step.prompt,
    ...optionalAgentTemplates(step),
  };
}

function normalizeMcpServer([name, server]: [string, TestAgentMcpServer]): NonNullable<
  Extract<ModelStep, {kind: 'agent'}>['customMcpServers']
>[number] {
  const include = server.include === undefined ? {} : {include: server.include};
  if ('url' in server) {
    const headerTemplates = valueTemplates('agent.mcp_servers.headers.value', server.headers);
    return {
      name,
      url: server.url,
      ...(server.headers === undefined ? {} : {headers: server.headers}),
      ...include,
      ...(headerTemplates === undefined ? {} : {templates: {headers: headerTemplates}}),
    };
  }
  const envTemplates = valueTemplates('agent.mcp_servers.env.value', server.env) ?? {};
  return {
    name,
    command: server.command,
    args: server.args ?? [],
    ...(server.env === undefined ? {} : {env: server.env}),
    ...(server.include === undefined ? {} : {include: server.include}),
    ...(Object.keys(envTemplates).length === 0 ? {} : {templates: {env: envTemplates}}),
  };
}

function normalizeToolStep(step: TestToolStep, base: ReturnType<typeof stepBase>): ModelStep {
  return {
    ...base,
    kind: 'tool',
    tool: splitToolId(step.tool),
    ...(step.connection === undefined ? {} : {connection: step.connection}),
    ...(step.with === undefined ? {} : {with: step.with}),
    ...(step.outputs === undefined ? {} : {outputMappings: outputMappings(step.outputs)}),
    ...optionalToolTemplates(step),
  };
}

function normalizeActionStep(step: TestActionStep, base: ReturnType<typeof stepBase>): ModelStep {
  const withTree = step.with === undefined ? undefined : withTemplateTree(step.with, 'action.with');
  const env = envTemplates(step.env);
  const templates = {
    ...(withTree === undefined ? {} : {with: withTree}),
    ...(env === undefined ? {} : {env}),
  };
  return {
    ...base,
    kind: 'action',
    action: {
      uses: step.uses,
      digest: `sha256:${'0'.repeat(64)}`,
      name: 'Test action',
      main: 'index.ts',
      inputs: {},
      integrations: {},
      ...step.action,
    },
    ...(step.with === undefined ? {} : {with: step.with}),
    ...optionalStepEnv(step.env),
    outputs: step.outputs ?? {},
    ...(Object.keys(templates).length === 0 ? {} : {templates}),
  };
}

// Like sync: inner steps read the composite's `inputs`, which exist only once it opens.
function normalizeCompositeStep(
  step: TestCompositeStep,
  jobId: string,
  base: ReturnType<typeof stepBase>,
): ModelStep {
  const withTree = step.with === undefined ? undefined : withTemplateTree(step.with, 'action.with');
  const env = envTemplates(step.env);
  const templates = {
    ...(withTree === undefined ? {} : {with: withTree}),
    ...(env === undefined ? {} : {env}),
  };
  const outputs = step.composite?.outputs ?? {};
  return {
    ...base,
    kind: 'composite',
    composite: {
      uses: step.uses,
      origin: 'local',
      digest: step.composite?.digest ?? TEST_COMPOSITE_DIGEST,
      name: step.composite?.name ?? 'Test composite',
      inputs: step.composite?.inputs ?? {},
      outputs: Object.fromEntries(
        Object.entries(outputs).map(([name, output]) => [
          name,
          {
            declaration: {type: output.type, required: false},
            value: fieldTemplate('action.outputs', output.value) ?? [
              {kind: 'literal' as const, value: output.value},
            ],
          },
        ]),
      ),
      integrations: {},
    },
    ...(step.with === undefined ? {} : {with: step.with}),
    ...optionalStepEnv(step.env),
    outputs: Object.fromEntries(
      Object.entries(outputs).map(([name, output]) => [name, {type: output.type, required: false}]),
    ),
    steps: step.steps.map((inner, index) =>
      scopeSession(deferInputs(normalizeStep(inner, jobId, index, base.id)) as ModelStep, base.id),
    ),
    ...(Object.keys(templates).length === 0 ? {} : {templates}),
  };
}

const WHOLE_INPUT_REFERENCE = /^\s*\$\{\{\s*inputs\.[A-Za-z_][A-Za-z0-9_]*\s*\}\}\s*$/;

// Like sync: a session key inside a composite is scoped to the use unless it is exactly an input.
function scopeSession(step: ModelStep, scope: string): ModelStep {
  if (step.kind !== 'agent' || step.session === undefined) return step;
  const source = step.session.key
    .map((segment) =>
      segment.kind === 'literal' ? segment.value : `$\{{ ${segment.expression.source} }}`,
    )
    .join('');
  if (WHOLE_INPUT_REFERENCE.test(source)) return step;
  return {...step, session: {...step.session, scope}};
}

function deferInputs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deferInputs);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (
    record.kind === 'deferred' &&
    Array.isArray(record.roots) &&
    record.roots.includes('inputs') &&
    record.fillTarget === 'run-creation'
  ) {
    return {...record, fillTarget: 'step-dispatch'};
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, deferInputs(child)]),
  );
}

function testAgentStepSession(
  session: NonNullable<TestAgentStep['session']>,
): NonNullable<Extract<ModelStep, {kind: 'agent'}>['session']> {
  const keySource = typeof session === 'string' ? session : session.key;
  const mode = typeof session === 'string' ? 'resume' : (session.mode ?? 'resume');
  return {
    key: fieldTemplate('agent.session', keySource) ?? [{kind: 'literal', value: keySource}],
    mode,
  };
}

function stepBase(step: TestWorkflowStep, jobId: string, stepIndex: number, parentId?: string) {
  const local = step.key === undefined ? `step-${stepIndex + 1}` : stableId(step.key);
  return {
    id: parentId === undefined ? `${jobId}-${local}` : `${parentId}.${local}`,
    ...(step.key === undefined ? {} : {key: step.key}),
    ...(step.name === undefined ? {} : {name: step.name}),
    ...(step.workingDirectory === undefined ? {} : {workingDirectory: step.workingDirectory}),
    ...(step.sourceLocation === undefined ? {} : {sourceLocation: step.sourceLocation}),
    ...(step.if === undefined ? {} : {if: step.if}),
    ...(step.runAfter === undefined ? {} : {runAfter: step.runAfter}),
    ...(step.gate === undefined ? {} : {gate: step.gate}),
  };
}

function normalizeStringArray(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function optionalScopedEnv(
  env: WorkflowModel['env'] | undefined,
):
  | {env: NonNullable<WorkflowModel['env']>; templates: {env: WorkflowEnvTemplates}}
  | {env: NonNullable<WorkflowModel['env']>}
  | Record<string, never> {
  if (env === undefined || Object.keys(env).length === 0) return {};
  const templates = envTemplates(env);
  return templates === undefined ? {env} : {env, templates: {env: templates}};
}

function optionalStepEnv(
  env: WorkflowModel['env'] | undefined,
): {env: NonNullable<WorkflowModel['env']>} | Record<string, never> {
  if (env === undefined || Object.keys(env).length === 0) return {};
  return {env};
}

function optionalRunTemplates(step: TestRunStep) {
  const command = fieldTemplate('run', step.run);
  const name = step.name === undefined ? undefined : fieldTemplate('step.name', step.name);
  const workingDirectory =
    step.workingDirectory === undefined
      ? undefined
      : fieldTemplate('step.working_directory', step.workingDirectory);
  const env = envTemplates(step.env);
  if (
    command === undefined &&
    name === undefined &&
    workingDirectory === undefined &&
    env === undefined
  ) {
    return {};
  }
  return {
    templates: {
      ...(command === undefined ? {} : {command}),
      ...(name === undefined ? {} : {name}),
      ...(workingDirectory === undefined ? {} : {workingDirectory}),
      ...(env === undefined ? {} : {env}),
    },
  };
}

function repositoryContextTemplate(value: boolean | string | readonly string[] | undefined) {
  return typeof value === 'string' ? fieldTemplate('agent.repository_context', value) : undefined;
}

function optionalAgentTemplates(step: TestAgentStep) {
  const prompt = fieldTemplate('agent.prompt', step.prompt);
  const model = step.model === undefined ? undefined : fieldTemplate('agent.model', step.model);
  const provider =
    step.provider === undefined ? undefined : fieldTemplate('agent.provider', step.provider);
  const thinking =
    step.thinking === undefined ? undefined : fieldTemplate('agent.thinking', step.thinking);
  const repositoryContextInstructions = repositoryContextTemplate(
    step.repositoryContext?.instructions,
  );
  const repositoryContextSkills = repositoryContextTemplate(step.repositoryContext?.skills);
  const name = step.name === undefined ? undefined : fieldTemplate('step.name', step.name);
  const workingDirectory =
    step.workingDirectory === undefined
      ? undefined
      : fieldTemplate('step.working_directory', step.workingDirectory);
  if (
    prompt === undefined &&
    model === undefined &&
    provider === undefined &&
    thinking === undefined &&
    repositoryContextInstructions === undefined &&
    repositoryContextSkills === undefined &&
    name === undefined &&
    workingDirectory === undefined
  ) {
    return {};
  }
  return {
    templates: {
      ...(prompt === undefined ? {} : {prompt}),
      ...(repositoryContextInstructions === undefined ? {} : {repositoryContextInstructions}),
      ...(repositoryContextSkills === undefined ? {} : {repositoryContextSkills}),
      ...(model === undefined ? {} : {model}),
      ...(provider === undefined ? {} : {provider}),
      ...(thinking === undefined ? {} : {thinking}),
      ...(name === undefined ? {} : {name}),
      ...(workingDirectory === undefined ? {} : {workingDirectory}),
    },
  };
}

function optionalToolTemplates(step: TestToolStep) {
  const withTree = step.with === undefined ? undefined : withTemplateTree(step.with, 'tool.with');
  const name = step.name === undefined ? undefined : fieldTemplate('step.name', step.name);
  if (withTree === undefined && name === undefined) return {};
  return {
    templates: {
      ...(withTree === undefined ? {} : {with: withTree}),
      ...(name === undefined ? {} : {name}),
    },
  };
}

function withTemplateTree(
  value: WorkflowJsonValue,
  field: 'tool.with' | 'action.with',
): WorkflowJsonTemplateTree | undefined {
  if (Array.isArray(value)) {
    const trees = value.map((child) => withTemplateTree(child, field));
    return trees.every((tree) => tree === undefined) ? undefined : trees;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).flatMap(([key, child]) => {
      const tree = withTemplateTree(child, field);
      return tree === undefined ? [] : [[key, tree] as const];
    });
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
  }
  if (typeof value !== 'string') return undefined;
  return fieldTemplate(field, value);
}

function outputMappings(outputs: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    Object.entries(outputs).map(([key, source]) => {
      const template = fieldTemplate('tool.outputs', source);
      if (template === undefined || template.length !== 1 || template[0]?.kind !== 'deferred') {
        throw new Error(
          `Expected test tool output mapping to be exactly one expression for ${key}: ${source}`,
        );
      }
      return [key, template[0].expression];
    }),
  );
}

function splitToolId(source: string): {readonly id: string; readonly method?: string} {
  const dotIndex = source.indexOf('.');
  if (dotIndex < 1 || dotIndex === source.length - 1) return {id: source};
  return {id: source.slice(0, dotIndex), method: source.slice(dotIndex + 1)};
}

function envTemplates(env: WorkflowModel['env'] | undefined): WorkflowEnvTemplates | undefined {
  if (env === undefined) return undefined;

  const templates = Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => {
      const template = fieldTemplate('env.value', value);
      return template === undefined ? [] : [[key, template]];
    }),
  );

  return Object.keys(templates).length === 0 ? undefined : templates;
}

function valueTemplates(
  field: WorkflowInterpolationField,
  values: Readonly<Record<string, string>> | undefined,
): Record<string, readonly ResolvedFieldSegment[]> | undefined {
  const templates = Object.fromEntries(
    Object.entries(values ?? {}).flatMap(([key, value]) => {
      const template = fieldTemplate(field, value);
      return template === undefined ? [] : [[key, template]];
    }),
  );
  return Object.keys(templates).length === 0 ? undefined : templates;
}

function fieldTemplate(
  field: WorkflowInterpolationField,
  source: string,
): readonly ResolvedFieldSegment[] | undefined {
  const segments = parseWorkflowTemplate(source);
  if (!segments.some((segment) => segment.kind === 'expr')) return undefined;
  const plan = planInterpolationField({field, segments});
  if (!plan.ok) {
    throw new Error(
      `Invalid test workflow template for ${field}: ${plan.violations
        .map((violation) => violation.source)
        .join(', ')}`,
    );
  }
  return plan.plan.field.segments;
}

function requiredFieldTemplate(
  field: WorkflowInterpolationField,
  source: string,
): readonly ResolvedFieldSegment[] {
  const template = fieldTemplate(field, source);
  if (template === undefined) {
    throw new Error(`Expected test workflow template for ${field}: ${source}`);
  }
  return template;
}

function stableId(sourceName: string): string {
  const id = sourceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return id.length === 0 ? 'unnamed' : id;
}
