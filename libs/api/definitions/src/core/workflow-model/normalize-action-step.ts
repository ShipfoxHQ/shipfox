import {
  type AvailabilitySite,
  coerceStepOutputs,
  type ExpressionTypeEnvironment,
  type OutputDeclarations,
  validateJsonSchema,
  type WorkflowStepTypeOverlay,
} from '@shipfox/expression';
import type {ActionManifest, WorkflowDocumentStep} from '@shipfox/workflow-document';
import type {ResolvedAction, ResolvedActions} from '../entities/action-snapshot.js';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {
  WorkflowFieldTemplate,
  WorkflowJsonTemplateTree,
  WorkflowJsonValue,
  WorkflowModelAction,
  WorkflowModelActionInput,
  WorkflowModelActionIntegration,
  WorkflowModelActionStep,
} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {
  resolveAgentToolConnection,
  validateAgentToolSelection,
} from './normalize-agent-integrations.js';
import {normalizeEnv} from './normalize-env.js';
import type {WorkflowModelStepBaseFields} from './normalize-jobs.js';
import {normalizeWithTemplates} from './normalize-tool-step.js';
import {issue} from './validation-issue.js';

/** The manifest-derived fields of an action step, resolved before its type overlay exists. */
export interface NormalizedActionFields {
  readonly action: WorkflowModelAction;
  readonly outputs: OutputDeclarations;
  readonly withTemplates: WorkflowJsonTemplateTree | undefined;
  /** The `steps.<key>` overlay, typing later references from the manifest outputs. */
  readonly overlay: WorkflowStepTypeOverlay;
}

interface ActionStepParams {
  step: WorkflowDocumentStep;
  stepId: string;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  integrationValidationContext?: IntegrationValidationContext | undefined;
  actionManifests?: ResolvedActions | undefined;
}

export function normalizeActionFields(
  params: ActionStepParams,
): NormalizedActionFields | undefined {
  const uses = params.step.uses ?? '';
  const resolved = params.actionManifests?.get(uses);
  if (resolved === undefined) {
    params.issues.push(
      issue({
        code: 'action-not-resolved',
        message: `Action "${uses}" could not be resolved.`,
        path: stepPath(params, 'uses'),
        details: {uses},
      }),
    );
    return undefined;
  }

  const {manifest} = resolved;
  const invalidSchemas = validateManifestSchemas(params, manifest);
  validateWithInputs(params, manifest, invalidSchemas);
  const withTemplates = normalizeWithTemplates({
    ...params,
    field: 'action.with',
    withValue: params.step.with,
    onTemplate: (template, path) => validateSecretPlacement(params, template, path),
  });
  const integrations = normalizeActionIntegrations(params, manifest);
  const outputs = manifestOutputs(manifest);

  return {
    action: createModelAction(uses, resolved, integrations),
    outputs,
    withTemplates,
    overlay: {key: params.step.key ?? params.stepId, outputs},
  };
}

export function buildActionStep(params: {
  fields: NormalizedActionFields;
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowModelActionStep {
  const stepEnv = normalizeEnv({
    env: params.step.env,
    path: stepPath(params, 'env'),
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
  const templates = {
    ...(params.fields.withTemplates === undefined ? {} : {with: params.fields.withTemplates}),
    ...(params.name === undefined ? {} : {name: params.name}),
    ...(params.workingDirectory === undefined ? {} : {workingDirectory: params.workingDirectory}),
    ...(stepEnv.templates === undefined ? {} : {env: stepEnv.templates.env}),
  };

  return {
    ...params.stepBase,
    kind: 'action',
    action: params.fields.action,
    ...(params.step.with === undefined ? {} : {with: params.step.with as WorkflowJsonValue}),
    ...(stepEnv.env === undefined ? {} : {env: stepEnv.env}),
    outputs: params.fields.outputs,
    ...(Object.keys(templates).length === 0 ? {} : {templates}),
  };
}

function createModelAction(
  uses: string,
  resolved: ResolvedAction,
  integrations: Readonly<Record<string, WorkflowModelActionIntegration>>,
): WorkflowModelAction {
  const inputs: Record<string, WorkflowModelActionInput> = Object.create(null) as Record<
    string,
    WorkflowModelActionInput
  >;
  for (const [name, input] of Object.entries(resolved.manifest.inputs ?? {})) {
    inputs[name] = {
      type: input.type,
      ...(input.schema === undefined ? {} : {schema: input.schema}),
      required: input.required,
      ...(input.default === undefined ? {} : {default: input.default as WorkflowJsonValue}),
    };
  }
  return {
    uses,
    origin: resolved.registry === undefined ? 'local' : 'registry',
    ...(resolved.registry === undefined
      ? {}
      : {package: resolved.registry.package, version: resolved.registry.version}),
    digest: resolved.digest,
    name: resolved.manifest.name,
    main: resolved.manifest.main,
    inputs,
    integrations,
  };
}

// The manifest default is `required: false`, and workflow step outputs treat an
// absent flag as required, so the flag is always written.
function manifestOutputs(manifest: ActionManifest): OutputDeclarations {
  const outputs: Record<string, OutputDeclarations[string]> = Object.create(null) as Record<
    string,
    OutputDeclarations[string]
  >;
  for (const [key, output] of Object.entries(manifest.outputs ?? {})) {
    outputs[key] = {
      type: output.type,
      ...(output.schema === undefined ? {} : {schema: output.schema}),
      required: output.required,
    };
  }
  return outputs;
}

// Invalid schemas cannot be compiled, so inputs using one skip the literal check.
function validateManifestSchemas(
  params: ActionStepParams,
  manifest: ActionManifest,
): ReadonlySet<string> {
  const invalidInputs = new Set<string>();
  const declarations = [
    ...Object.entries(manifest.inputs ?? {}).map(
      ([name, value]) => ['inputs', name, value] as const,
    ),
    ...Object.entries(manifest.outputs ?? {}).map(
      ([name, value]) => ['outputs', name, value] as const,
    ),
  ];
  for (const [section, name, declaration] of declarations) {
    if (declaration.schema === undefined) continue;
    const validation = validateJsonSchema(declaration.schema);
    if (validation.ok) continue;
    if (section === 'inputs') invalidInputs.add(name);
    params.issues.push(
      issue({
        code: 'action-manifest-invalid',
        message: `Action "${params.step.uses}" declares an invalid JSON Schema for ${section}.${name}.`,
        path: stepPath(params, 'uses'),
        details: {
          uses: params.step.uses,
          field: `${section}.${name}.schema`,
          reason: validation.reason,
        },
      }),
    );
  }
  return invalidInputs;
}

function validateWithInputs(
  params: ActionStepParams,
  manifest: ActionManifest,
  invalidSchemas: ReadonlySet<string>,
): void {
  const inputs = manifest.inputs ?? {};
  const withValue = params.step.with ?? {};

  for (const [key, value] of Object.entries(withValue)) {
    const input = Object.hasOwn(inputs, key) ? inputs[key] : undefined;
    if (input === undefined) {
      params.issues.push(
        issue({
          code: 'action-input-unknown',
          message: `Action "${params.step.uses}" has no input "${key}".`,
          path: stepPath(params, 'with', key),
          details: {uses: params.step.uses, input: key},
        }),
      );
      continue;
    }
    if (invalidSchemas.has(key) || containsInterpolation(value)) continue;
    validateLiteralInput(params, key, input, value);
  }

  for (const [key, input] of Object.entries(inputs)) {
    if (!input.required || Object.hasOwn(withValue, key)) continue;
    params.issues.push(
      issue({
        code: 'action-input-missing',
        message: `Action "${params.step.uses}" requires input "${key}".`,
        path: stepPath(params, 'with', key),
        details: {uses: params.step.uses, input: key},
      }),
    );
  }
}

// Literal values go through the same coercion that dispatch applies after
// evaluating expressions, so sync accepts exactly what dispatch accepts.
function validateLiteralInput(
  params: ActionStepParams,
  key: string,
  input: NonNullable<ActionManifest['inputs']>[string],
  value: unknown,
): void {
  const result = coerceStepOutputs({
    declarations: {[key]: {type: input.type, schema: input.schema}},
    output: {[key]: value},
  });
  if (result.ok) return;

  params.issues.push(
    issue({
      code: 'action-input-invalid',
      message:
        result.error.reason === 'schema_invalid'
          ? `Action input "${key}" does not match its JSON Schema.`
          : `Action input "${key}" must be a ${input.type} value.`,
      path: stepPath(params, 'with', key),
      details: {
        uses: params.step.uses,
        input: key,
        expected: input.type,
        reason: result.error.reason,
        ...(result.error.schemaError === undefined ? {} : {schemaError: result.error.schemaError}),
      },
    }),
  );
}

// The runner fills a secret input by name, so a secret must be the whole value
// of a top-level input. The planner already rejects secrets inside larger expressions.
function validateSecretPlacement(
  params: ActionStepParams,
  template: WorkflowFieldTemplate,
  path: readonly WorkflowModelValidationIssuePathSegment[],
): void {
  const readsSecrets = template.some(
    (segment) => segment.kind === 'deferred' && segment.roots.includes('secrets'),
  );
  if (!readsSecrets) return;
  const topLevelInputDepth = stepPath(params, 'with').length + 1;
  if (template.length === 1 && path.length === topLevelInputDepth) return;

  params.issues.push(
    issue({
      code: 'action-secret-input-invalid',
      message:
        'Secret references in `with` must be the whole value of a top-level input, such as `$' +
        '{{ secrets.NPM_TOKEN }}`.',
      path,
      details: {uses: params.step.uses},
    }),
  );
}

function normalizeActionIntegrations(
  params: ActionStepParams,
  manifest: ActionManifest,
): Readonly<Record<string, WorkflowModelActionIntegration>> {
  const declared = manifest.integrations ?? {};
  const bindings = params.step.connections ?? {};
  const integrations: Record<string, WorkflowModelActionIntegration> = Object.create(
    null,
  ) as Record<string, WorkflowModelActionIntegration>;

  for (const alias of Object.keys(bindings)) {
    if (Object.hasOwn(declared, alias)) continue;
    params.issues.push(
      issue({
        code: 'action-connection-unknown',
        message: `Action "${params.step.uses}" declares no integration alias "${alias}".`,
        path: stepPath(params, 'connections', alias),
        details: {uses: params.step.uses, alias},
      }),
    );
  }

  for (const [alias, integration] of Object.entries(declared)) {
    const connection = Object.hasOwn(bindings, alias) ? bindings[alias] : undefined;
    if (connection === undefined) {
      params.issues.push(
        issue({
          code: 'action-connection-missing',
          message: `Action "${params.step.uses}" needs a connection for integration alias "${alias}" in \`connections\`.`,
          path: stepPath(params, 'connections'),
          details: {uses: params.step.uses, alias, provider: integration.provider},
        }),
      );
      continue;
    }
    validateActionIntegration(params, alias, integration, connection);
    integrations[alias] = {
      provider: integration.provider,
      connection,
      include: [...new Set(integration.include)],
      allowWrite: integration.allow_write,
    };
  }

  return integrations;
}

function validateActionIntegration(
  params: ActionStepParams,
  alias: string,
  integration: NonNullable<ActionManifest['integrations']>[string],
  connectionSlug: string,
): void {
  const context = params.integrationValidationContext;
  if (context === undefined) return;

  const details = {uses: params.step.uses, alias};
  const selectorsByToken = resolveAgentToolConnection({
    connectionSlug,
    expectedProvider: integration.provider,
    path: stepPath(params, 'connections', alias),
    details,
    issues: params.issues,
    context,
  });
  if (selectorsByToken === undefined) return;

  // Selectors come from the manifest, so their issues point at `uses`.
  validateAgentToolSelection({
    include: integration.include,
    allowWrite: integration.allow_write,
    selectorsByToken,
    selectorPath: () => stepPath(params, 'uses'),
    details,
    issues: params.issues,
  });
}

function containsInterpolation(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') {
      if (current.includes('$' + '{{')) return true;
      continue;
    }
    if (typeof current === 'object' && current !== null) pending.push(...Object.values(current));
  }
  return false;
}

function stepPath(
  params: {sourceName: string; stepIndex: number},
  ...rest: readonly WorkflowModelValidationIssuePathSegment[]
): readonly WorkflowModelValidationIssuePathSegment[] {
  return ['jobs', params.sourceName, 'steps', params.stepIndex, ...rest];
}
