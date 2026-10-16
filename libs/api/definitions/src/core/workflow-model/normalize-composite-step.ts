import {
  type AvailabilitySite,
  availabilitySites,
  buildCompositeScopeEnvironment,
  buildTypedRootsEnvironment,
  type ExpressionTypeEnvironment,
  type OutputDeclarations,
  parseWorkflowTemplate,
  type WorkflowStepTypeOverlay,
} from '@shipfox/expression';
import {
  actionPathRelativePart,
  type CompositeActionManifest,
  isCompositeActionManifest,
  type WorkflowDocumentStep,
  type WorkflowDocumentStepIntegration,
} from '@shipfox/workflow-document';
import {resolveCompositeUses} from '../composite-action-references.js';
import type {
  ResolvedAction,
  ResolvedActions,
  ResolvedCompositeAction,
} from '../entities/action-snapshot.js';
import type {
  WorkflowFieldTemplate,
  WorkflowJsonTemplateTree,
  WorkflowJsonValue,
  WorkflowModelActionIntegration,
  WorkflowModelCompositeOutput,
  WorkflowModelCompositeStep,
  WorkflowModelStep,
  WorkflowSourceLocation,
  WorkflowStepSourceLocationMap,
} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {
  type ActionStepParams,
  manifestInputs,
  manifestOutputs,
  normalizeActionIntegrations,
  stepPath,
  validateManifestSchemas,
  validateWithInputs,
} from './normalize-action-step.js';
import {normalizeEnv} from './normalize-env.js';
import type {NormalizeContext, StepScope, WorkflowModelStepBaseFields} from './normalize-jobs.js';
import {normalizeWithTemplates} from './normalize-tool-step.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {issue} from './validation-issue.js';

type ResolvedComposite = ResolvedAction & {
  readonly manifest: CompositeActionManifest;
  readonly composite: ResolvedCompositeAction;
};

/** The composite action a `uses` names, or undefined for a JavaScript or unresolved action. */
export function compositeActionFor(
  actions: ResolvedActions | undefined,
  uses: string,
): {uses: string; resolved: ResolvedComposite} | undefined {
  const resolved = actions?.get(uses);
  if (resolved?.composite === undefined || !isCompositeActionManifest(resolved.manifest)) {
    return undefined;
  }
  return {uses, resolved: resolved as ResolvedComposite};
}

/** A job may run at most this many steps once its composite actions are expanded. */
export const MAX_EXPANDED_JOB_STEPS = 200;

/**
 * How many steps a list runs once its composite actions are expanded, read
 * from the manifests before anything is normalized. Each composite is counted
 * once, so a wide or deep tree stays cheap to reject. The count stops growing
 * past the limit.
 */
export function expandedStepCount(
  steps: readonly WorkflowDocumentStep[],
  actions: ResolvedActions | undefined,
): number {
  const sizes = new Map<string, number>();
  const visiting = new Set<string>();
  const count = (
    list: readonly WorkflowDocumentStep[],
    parent: {key: string; isRegistry: boolean} | undefined,
  ): number => {
    let total = 0;
    for (const step of list) {
      total += 1 + compositeSize(step, parent);
      if (total > MAX_EXPANDED_JOB_STEPS) break;
    }
    return total;
  };
  const compositeSize = (
    step: WorkflowDocumentStep,
    parent: {key: string; isRegistry: boolean} | undefined,
  ): number => {
    if (step.uses === undefined) return 0;
    const key = compositeKey(step.uses, parent);
    const composite = key === undefined ? undefined : compositeActionFor(actions, key);
    // Resolution rejects cycles; the guard keeps a direct call from looping.
    if (key === undefined || composite === undefined || visiting.has(key)) return 0;
    const known = sizes.get(key);
    if (known !== undefined) return known;
    visiting.add(key);
    const size = count(composite.resolved.manifest.steps, {
      key,
      isRegistry: composite.resolved.registry !== undefined,
    });
    visiting.delete(key);
    sizes.set(key, size);
    return size;
  };
  return count(steps, undefined);
}

function compositeKey(
  uses: string,
  parent: {key: string; isRegistry: boolean} | undefined,
): string | undefined {
  if (parent === undefined) return uses;
  const result = resolveCompositeUses({
    uses,
    parentKey: parent.key,
    parentIsRegistry: parent.isRegistry,
  });
  return result.ok ? result.key : undefined;
}

/** The manifest-derived fields of a composite step, resolved before its type overlay exists. */
export interface NormalizedCompositeFields {
  readonly uses: string;
  readonly resolved: ResolvedComposite;
  readonly integrations: Readonly<Record<string, WorkflowModelActionIntegration>>;
  readonly outputs: OutputDeclarations;
  /** The caller's `with`, without the secret inputs. */
  readonly with: Readonly<Record<string, unknown>> | undefined;
  readonly withTemplates: WorkflowJsonTemplateTree | undefined;
  /** The caller's secret reference for each secret input it passes, such as `${{ secrets.NPM_TOKEN }}`. */
  readonly secretBindings: ReadonlyMap<string, string>;
  readonly overlay: WorkflowStepTypeOverlay;
}

export function normalizeCompositeFields(
  params: ActionStepParams & {uses: string; resolved: ResolvedComposite},
): NormalizedCompositeFields {
  const {manifest} = params.resolved;
  const invalidSchemas = validateManifestSchemas(params, manifest);
  validateWithInputs(params, manifest, invalidSchemas);
  const secretBindings = bindSecretInputs(params, manifest);
  const nonSecretWith = withoutSecretInputs(params.step.with, manifest);
  const withTemplates = normalizeWithTemplates({
    ...params,
    field: 'action.with',
    withValue: nonSecretWith,
  });
  const outputs = manifestOutputs(manifest);
  return {
    uses: params.uses,
    resolved: params.resolved,
    integrations: normalizeActionIntegrations(params, manifest),
    outputs,
    with: nonSecretWith,
    withTemplates,
    secretBindings,
    overlay: {key: params.step.key ?? params.stepId, outputs},
  };
}

const bareSecretReferencePattern = /^\$\{\{\s*secrets(?:\.[A-Za-z_][A-Za-z0-9_]*){1,2}\s*\}\}$/;

// A secret input takes a bare secret reference. Inside a composite action, the
// reference comes from an enclosing secret input, already rewritten. A secret
// sent to any other input would be resolved on the server, so it is rejected.
function bindSecretInputs(
  params: ActionStepParams,
  manifest: CompositeActionManifest,
): ReadonlyMap<string, string> {
  const inputs = manifest.inputs ?? {};
  const bindings = new Map<string, string>();
  for (const [name, value] of Object.entries(params.step.with ?? {})) {
    const input = Object.hasOwn(inputs, name) ? inputs[name] : undefined;
    if (input === undefined) continue;
    if (input.secret !== true) {
      if (referencesSecrets(value)) {
        params.issues.push(
          issue({
            code: 'action-secret-input-invalid',
            message: `Input "${name}" of action "${params.step.uses}" is not a secret input, so it cannot receive a secret. Declare it with \`secret: true\`.`,
            path: stepPath(params, 'with', name),
            details: {uses: params.step.uses, input: name},
          }),
        );
      }
      continue;
    }
    if (typeof value === 'string' && bareSecretReferencePattern.test(value)) {
      bindings.set(name, value.trim());
      continue;
    }
    params.issues.push(
      issue({
        code: 'action-secret-input-invalid',
        message:
          `Secret input "${name}" of action "${params.step.uses}" takes a secret reference, such as \`$` +
          '{{ secrets.NPM_TOKEN }}`, or a secret input of the enclosing composite action.',
        path: stepPath(params, 'with', name),
        details: {uses: params.step.uses, input: name},
      }),
    );
  }
  return bindings;
}

function withoutSecretInputs(
  withValue: Readonly<Record<string, unknown>> | undefined,
  manifest: CompositeActionManifest,
): Readonly<Record<string, unknown>> | undefined {
  if (withValue === undefined) return undefined;
  const inputs = manifest.inputs ?? {};
  const entries = Object.entries(withValue).filter(
    ([name]) => !(Object.hasOwn(inputs, name) && inputs[name]?.secret === true),
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** Normalizes the steps of one composite use and assembles the composite step. */
export function buildCompositeStep(params: {
  fields: NormalizedCompositeFields;
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  jobId: string;
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  scope: StepScope | undefined;
  context: NormalizeContext;
  normalizeSteps: (input: {
    steps: readonly WorkflowDocumentStep[];
    scope: StepScope;
    issues: WorkflowModelValidationIssue[];
    stepSourceLocations: WorkflowStepSourceLocationMap;
    context: NormalizeContext;
  }) => {steps: readonly WorkflowModelStep[]; overlays: readonly WorkflowStepTypeOverlay[]};
}): WorkflowModelCompositeStep {
  const {fields} = params;
  const {manifest, composite} = fields.resolved;
  // The run engine expands a composite into its inner steps, which have no flag of their own.
  if (params.step.continue_on_error === true) {
    params.issues.push(
      issue({
        code: 'composite-continue-on-error-unsupported',
        message:
          '`continue_on_error` is not supported on a composite action step. Set it on the steps inside the action.',
        path: stepPath(params, 'continue_on_error'),
        details: {uses: fields.uses},
      }),
    );
  }
  const stepEnv = normalizeEnv({
    env: params.step.env,
    path: stepPath(params, 'env'),
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });

  const innerIssues: WorkflowModelValidationIssue[] = [];
  const prepared = prepareInnerSteps({
    steps: manifest.steps,
    fields,
    sourceName: params.sourceName,
    issues: innerIssues,
    context: params.context,
  });
  const inputs = nonSecretInputDeclarations(manifest);
  const scopeRoots = buildCompositeScopeEnvironment({inputs});
  const inner = params.normalizeSteps({
    steps: prepared.steps,
    scope: {
      parentId: params.stepBase.id,
      roots: scopeRoots,
      envKeys: [...(params.scope?.envKeys ?? []), ...Object.keys(params.step.env ?? {})],
    },
    issues: innerIssues,
    stepSourceLocations: new Map([
      [params.sourceName, innerSourceLocations(fields.uses, fields.resolved)],
    ]),
    context: {...params.context, promptFiles: prepared.promptFiles},
  });
  const outputs = normalizeCompositeOutputs({
    manifest,
    overlays: inner.overlays,
    inputsRoot: scopeRoots,
    issues: innerIssues,
  });

  const locate = {
    uses: fields.uses,
    composite,
    sourceName: params.sourceName,
    callerPath: stepPath(params),
  };
  for (const innerIssue of innerIssues) params.issues.push(locateInnerIssue(innerIssue, locate));

  const templates = {
    ...(fields.withTemplates === undefined ? {} : {with: fields.withTemplates}),
    ...(params.name === undefined ? {} : {name: params.name}),
    ...(params.workingDirectory === undefined ? {} : {workingDirectory: params.workingDirectory}),
    ...(stepEnv.templates === undefined ? {} : {env: stepEnv.templates.env}),
  };
  const {registry} = fields.resolved;
  return {
    ...params.stepBase,
    kind: 'composite',
    composite: {
      uses: fields.uses,
      origin: registry === undefined ? 'local' : 'registry',
      ...(registry === undefined ? {} : {package: registry.package, version: registry.version}),
      digest: fields.resolved.digest,
      name: manifest.name,
      inputs: manifestInputs(manifest),
      outputs,
      integrations: fields.integrations,
    },
    ...(fields.with === undefined ? {} : {with: fields.with as WorkflowJsonValue}),
    ...(stepEnv.env === undefined ? {} : {env: stepEnv.env}),
    steps: inner.steps.map((step) => deferCompositeInputs(step) as WorkflowModelStep),
    ...(Object.keys(templates).length === 0 ? {} : {templates}),
  };
}

// Inside a composite, `inputs` names the composite's inputs, which exist only
// once the composite opens. A segment that reads them would otherwise be
// planned for run creation and filled with the run's own inputs.
function deferCompositeInputs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deferCompositeInputs);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (
    record.kind === 'deferred' &&
    Array.isArray(record.roots) &&
    record.roots.includes('inputs') &&
    typeof record.fillTarget === 'string' &&
    fillsBeforeStepDispatch(record.fillTarget)
  ) {
    return {...record, fillTarget: 'step-dispatch'};
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [key, deferCompositeInputs(child)]),
  );
}

function fillsBeforeStepDispatch(fillTarget: string): boolean {
  const index = availabilitySites.indexOf(fillTarget as AvailabilitySite);
  return index >= 0 && index < availabilitySites.indexOf('step-dispatch');
}

function nonSecretInputDeclarations(manifest: CompositeActionManifest): OutputDeclarations {
  const declarations: Record<string, OutputDeclarations[string]> = Object.create(null) as Record<
    string,
    OutputDeclarations[string]
  >;
  for (const [name, input] of Object.entries(manifest.inputs ?? {})) {
    if (input.secret === true) continue;
    declarations[name] = {
      type: input.type,
      ...(input.schema === undefined ? {} : {schema: input.schema}),
      required: input.required || input.default !== undefined,
    };
  }
  return declarations;
}

function innerSourceLocations(
  uses: string,
  resolved: ResolvedComposite,
): ReadonlyMap<number, WorkflowSourceLocation> {
  const file = {
    kind: 'action' as const,
    uses,
    digest: resolved.digest,
    path: resolved.composite.manifestFile,
  };
  return new Map(
    [...resolved.composite.stepLocations].map(([index, location]) => [index, {...location, file}]),
  );
}

// The values read the composite's inputs and its steps, and are filled when its
// last inner step finishes.
function normalizeCompositeOutputs(params: {
  manifest: CompositeActionManifest;
  overlays: readonly WorkflowStepTypeOverlay[];
  inputsRoot: ExpressionTypeEnvironment;
  issues: WorkflowModelValidationIssue[];
}): Readonly<Record<string, WorkflowModelCompositeOutput>> {
  const typeOverlay = {
    ...buildTypedRootsEnvironment({steps: params.overlays}),
    ...(params.inputsRoot.inputs === undefined ? {} : {inputs: params.inputsRoot.inputs}),
  };
  const outputs: Record<string, WorkflowModelCompositeOutput> = Object.create(null) as Record<
    string,
    WorkflowModelCompositeOutput
  >;
  for (const [name, output] of Object.entries(params.manifest.outputs ?? {})) {
    const source = output.value ?? '';
    const value = parseInterpolationField({
      field: 'action.outputs',
      source,
      path: ['outputs', name, 'value'],
      issues: params.issues,
      fillSite: 'step-dispatch',
      typeOverlay,
    }) ?? [{kind: 'literal' as const, value: source}];
    outputs[name] = {
      declaration: {
        type: output.type,
        ...(output.schema === undefined ? {} : {schema: output.schema}),
        required: output.required,
      },
      value,
    };
  }
  return outputs;
}

interface CompositeAlias {
  readonly provider: string;
  readonly include: readonly string[];
  readonly allowWrite: boolean;
  /** The connection the caller bound the alias to. Unset when the binding is missing. */
  readonly connection: string | undefined;
}

interface PrepareContext {
  readonly fields: NormalizedCompositeFields;
  readonly sourceName: string;
  readonly issues: WorkflowModelValidationIssue[];
  readonly context: NormalizeContext;
  readonly aliases: ReadonlyMap<string, CompositeAlias>;
  readonly secretInputs: ReadonlySet<string>;
}

/**
 * Prepares the authored steps for one use. Checks that they read no secret,
 * rewrites secret inputs to the caller's secret references, resolves nested
 * `uses` to their keys, and binds integration aliases to the caller's
 * connections. Issue paths use the job step form with the inner index, so
 * they are located like the issues of the inner normalization.
 */
function prepareInnerSteps(params: {
  steps: readonly WorkflowDocumentStep[];
  fields: NormalizedCompositeFields;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  context: NormalizeContext;
}): {steps: WorkflowDocumentStep[]; promptFiles: ReadonlyMap<string, string>} {
  const {manifest} = params.fields.resolved;
  const context: PrepareContext = {
    ...params,
    aliases: compositeAliases(manifest, params.fields.integrations),
    secretInputs: new Set(
      Object.entries(manifest.inputs ?? {}).flatMap(([name, input]) =>
        input.secret === true ? [name] : [],
      ),
    ),
  };
  const promptFiles = new Map(params.context.promptFiles ?? []);
  const steps = params.steps.map((authored, index) => {
    const path = ['jobs', params.sourceName, 'steps', index] as const;
    rejectSecretReferences(authored, path, context);
    const step = mapStringLeaves(dropUnboundSecretForwards(authored, context), (value) =>
      rewriteSecretInputs(value, context),
    ) as WorkflowDocumentStep;
    addActionPromptFiles(step, path, context, promptFiles);
    return bindStepIntegrations(resolveStepUses(step, context), path, context);
  });
  return {steps, promptFiles};
}

function compositeAliases(
  manifest: CompositeActionManifest,
  bound: Readonly<Record<string, WorkflowModelActionIntegration>>,
): ReadonlyMap<string, CompositeAlias> {
  return new Map(
    Object.entries(manifest.integrations ?? {}).map(([alias, integration]) => [
      alias,
      {
        provider: integration.provider,
        include: integration.include,
        allowWrite: integration.allow_write,
        connection: Object.hasOwn(bound, alias) ? bound[alias]?.connection : undefined,
      },
    ]),
  );
}

function rejectSecretReferences(
  step: WorkflowDocumentStep,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  context: PrepareContext,
): void {
  forEachStringLeaf(step, path, (value, leafPath) => {
    if (!referencesSecrets(value)) return;
    context.issues.push(
      issue({
        code: 'composite-secrets-forbidden',
        message:
          'A composite action cannot read `secrets`. Declare a secret input with `secret: true`, and let the step that uses the action pass the secret.',
        path: leafPath,
        details: {uses: context.fields.uses},
      }),
    );
  });
}

const inputReferencePattern = /(?<!\$)\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

// A secret input has no value on the server: each expression that is exactly
// the input becomes the caller's secret reference, so the usual secret rules
// apply to it. An optional secret input the caller leaves out reads as empty.
function rewriteSecretInputs(value: string, context: PrepareContext): string {
  if (context.secretInputs.size === 0) return value;
  return value.replace(inputReferencePattern, (match, name: string) => {
    if (!context.secretInputs.has(name)) return match;
    return context.fields.secretBindings.get(name) ?? '';
  });
}

/** A value that is exactly one `${{ inputs.<name> }}` expression. */
export const WHOLE_INPUT_REFERENCE_PATTERN =
  /^\s*\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/;

// A nested action input that only forwards a secret input the caller left out
// is left out too, so an optional secret stays optional through every level.
function dropUnboundSecretForwards(
  step: WorkflowDocumentStep,
  context: PrepareContext,
): WorkflowDocumentStep {
  if (step.uses === undefined || step.with === undefined) return step;
  const entries = Object.entries(step.with).filter(([, value]) => {
    if (typeof value !== 'string') return true;
    const name = WHOLE_INPUT_REFERENCE_PATTERN.exec(value)?.[1];
    return (
      name === undefined ||
      !context.secretInputs.has(name) ||
      context.fields.secretBindings.has(name)
    );
  });
  if (entries.length === Object.keys(step.with).length) return step;
  return {...step, with: Object.fromEntries(entries)};
}

function resolveStepUses(
  step: WorkflowDocumentStep,
  context: PrepareContext,
): WorkflowDocumentStep {
  if (step.uses === undefined) return step;
  const result = resolveCompositeUses({
    uses: step.uses,
    parentKey: context.fields.uses,
    parentIsRegistry: context.fields.resolved.registry !== undefined,
  });
  // An unresolvable `uses` is reported once, when the step finds no action for it.
  return result.ok ? {...step, uses: result.key} : step;
}

// `${{ action.path }}/` prompt files come from the action's own files, keyed
// by the path as written, next to the repository files.
function addActionPromptFiles(
  step: WorkflowDocumentStep,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  context: PrepareContext,
  promptFiles: Map<string, string>,
): void {
  if (!Array.isArray(step.prompt)) return;
  const {composite} = context.fields.resolved;
  for (const [partIndex, part] of step.prompt.entries()) {
    if (typeof part === 'string') continue;
    const relativePath = actionPathRelativePart(part.file);
    if (relativePath === undefined) continue;
    const content = composite.files.get(relativePath);
    const reason = actionPromptFileIssue(content, context.fields.uses);
    if (reason !== undefined) {
      context.issues.push(
        issue({
          code: 'prompt-file-invalid',
          message: `Prompt file "${part.file}" ${reason}`,
          path: [...path, 'prompt', partIndex],
          details: {file: part.file, uses: context.fields.uses},
        }),
      );
    }
    // A failed file already has its issue, so the prompt reads it as empty.
    promptFiles.set(part.file, reason === undefined ? (content ?? '') : '');
  }
}

function actionPromptFileIssue(content: string | undefined, uses: string): string | undefined {
  if (content === undefined) return `is not in action ${uses}.`;
  return content.trim() === '' ? 'is empty.' : undefined;
}

/**
 * Binds the aliases an inner step names to the connections the caller bound
 * them to. A tool or agent step stays inside the alias, and a nested action's
 * grant must fit inside the outer alias it is bound to.
 */
function bindStepIntegrations(
  step: WorkflowDocumentStep,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  context: PrepareContext,
): WorkflowDocumentStep {
  if (step.tool !== undefined && step.connection !== undefined) {
    return bindToolStep(step, step.tool, step.connection, path, context);
  }
  if (step.integrations !== undefined) {
    return {
      ...step,
      integrations: step.integrations.map((integration, index) =>
        bindAgentIntegration(integration, [...path, 'integrations', index], context),
      ),
    };
  }
  if (step.uses !== undefined && step.connections !== undefined) {
    return {...step, connections: bindNestedActionAliases(step, step.connections, path, context)};
  }
  return step;
}

function bindToolStep(
  step: WorkflowDocumentStep,
  tool: string,
  aliasName: string,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  context: PrepareContext,
): WorkflowDocumentStep {
  const alias = lookupAlias(aliasName, [...path, 'connection'], context);
  if (alias === undefined) return step;
  if (!selectorCovered(tool, alias.include)) {
    context.issues.push(
      exceedsAliasIssue({
        message: `Tool "${tool}" is not in the \`include\` of integration alias "${aliasName}".`,
        path: [...path, 'tool'],
        context,
        details: {alias: aliasName, tool},
      }),
    );
  } else if (!alias.allowWrite && isWriteTool(tool, alias, context)) {
    context.issues.push(
      issue({
        code: 'integration-write-not-allowed',
        message: `Tool "${tool}" changes external data, but integration alias "${aliasName}" does not set \`allow_write: true\`.`,
        path: [...path, 'tool'],
        details: {alias: aliasName, tool, uses: context.fields.uses},
      }),
    );
  }
  return alias.connection === undefined ? step : {...step, connection: alias.connection};
}

function bindAgentIntegration(
  integration: WorkflowDocumentStepIntegration,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  context: PrepareContext,
): WorkflowDocumentStepIntegration {
  if (integration.connection === undefined) {
    context.issues.push(
      issue({
        code: 'missing-connection-for-integration',
        message:
          'An agent step inside a composite action needs `connection`, set to an integration alias of the action.',
        path,
        details: {uses: context.fields.uses},
      }),
    );
    return integration;
  }
  const aliasName = integration.connection;
  const alias = lookupAlias(aliasName, [...path, 'connection'], context);
  if (alias === undefined) return integration;
  const uncovered = integration.include.filter(
    (selector) => !selectorCovered(selector, alias.include),
  );
  if (uncovered.length > 0) {
    context.issues.push(
      exceedsAliasIssue({
        message: `Integration alias "${aliasName}" does not include ${uncovered.map((selector) => `"${selector}"`).join(', ')}.`,
        path: [...path, 'include'],
        context,
        details: {alias: aliasName, selectors: uncovered},
      }),
    );
  }
  if (integration.allow_write === true && !alias.allowWrite) {
    context.issues.push(
      exceedsAliasIssue({
        message: `Integration alias "${aliasName}" does not set \`allow_write: true\`, so the agent cannot get write tools.`,
        path: [...path, 'allow_write'],
        context,
        details: {alias: aliasName},
      }),
    );
  }
  return alias.connection === undefined
    ? integration
    : {...integration, connection: alias.connection};
}

// `connections` of a nested action names an alias of this composite, not a
// connection. The nested alias must fit inside it: same provider, every
// selector covered as written, and writes only if this alias allows them.
// Each level is checked against the one above it, so every grant fits inside
// the alias the caller bound at the top.
function bindNestedActionAliases(
  step: WorkflowDocumentStep,
  connections: Readonly<Record<string, string>>,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  context: PrepareContext,
): Record<string, string> {
  const nested =
    step.uses === undefined ? undefined : context.context.actionManifests?.get(step.uses);
  const bound: Record<string, string> = {};
  for (const [innerAlias, outerAliasName] of Object.entries(connections)) {
    const bindingPath = [...path, 'connections', innerAlias];
    bound[innerAlias] = outerAliasName;
    const outer = lookupAlias(outerAliasName, bindingPath, context);
    if (outer === undefined) continue;
    const declared = nested?.manifest.integrations?.[innerAlias];
    if (declared !== undefined) {
      const reasons = aliasFitIssues({declared, outer, outerAliasName});
      for (const reason of reasons) {
        context.issues.push(
          exceedsAliasIssue({
            message: `Integration alias "${innerAlias}" of action "${step.uses}" does not fit inside alias "${outerAliasName}": ${reason}`,
            path: bindingPath,
            context,
            details: {alias: innerAlias, outerAlias: outerAliasName, nested: step.uses},
          }),
        );
      }
    }
    if (outer.connection !== undefined) bound[innerAlias] = outer.connection;
  }
  return bound;
}

function aliasFitIssues(params: {
  declared: {provider: string; include: readonly string[]; allow_write: boolean};
  outer: CompositeAlias;
  outerAliasName: string;
}): string[] {
  const {declared, outer} = params;
  if (declared.provider !== outer.provider) {
    return [
      `it is a ${declared.provider} alias, and "${params.outerAliasName}" is ${outer.provider}.`,
    ];
  }
  const reasons: string[] = [];
  const uncovered = declared.include.filter(
    (selector) => !selectorCovered(selector, outer.include),
  );
  if (uncovered.length > 0) {
    reasons.push(`it includes ${uncovered.map((selector) => `"${selector}"`).join(', ')}.`);
  }
  if (declared.allow_write && !outer.allowWrite) {
    reasons.push('it allows writes, and the outer alias does not.');
  }
  return reasons;
}

/** A selector is covered when the list names it, or names its family (`family` covers `family.method`). */
function selectorCovered(selector: string, include: readonly string[]): boolean {
  if (include.includes(selector)) return true;
  const dot = selector.indexOf('.');
  return dot > 0 && include.includes(selector.slice(0, dot));
}

function lookupAlias(
  aliasName: string,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  context: PrepareContext,
): CompositeAlias | undefined {
  const alias = context.aliases.get(aliasName);
  if (alias !== undefined) return alias;
  context.issues.push(
    issue({
      code: 'action-connection-unknown',
      message: `Composite action "${context.fields.uses}" declares no integration alias "${aliasName}".`,
      path,
      details: {uses: context.fields.uses, alias: aliasName},
    }),
  );
  return undefined;
}

// The tool catalog says which tools write. Without the catalog, the write
// check waits for a validation that has it.
function isWriteTool(tool: string, alias: CompositeAlias, context: PrepareContext): boolean {
  const catalog = context.context.integrationValidationContext?.agentToolCatalogs.get(
    alias.provider,
  );
  const dot = tool.indexOf('.');
  const entry = catalog?.tools.find((candidate) =>
    dot === -1 ? candidate.id === tool : candidate.id === tool.slice(0, dot),
  );
  if (entry === undefined) return false;
  if (dot === -1) return entry.sensitivity === 'write';
  const method = entry.methods?.find((candidate) => candidate.id === tool.slice(dot + 1));
  return method?.sensitivity === 'write';
}

function exceedsAliasIssue(params: {
  message: string;
  path: readonly WorkflowModelValidationIssuePathSegment[];
  context: PrepareContext;
  details: Readonly<Record<string, unknown>>;
}): WorkflowModelValidationIssue {
  return issue({
    code: 'action-integration-exceeds-alias',
    message: params.message,
    path: params.path,
    details: {uses: params.context.fields.uses, ...params.details},
  });
}

/** Where an issue inside a composite action sits in its manifest. */
export interface CompositeIssueLocation {
  readonly uses: string;
  /** Repository path of the manifest, or `uses/action.yml` for a registry action. */
  readonly file: string;
  readonly line?: number;
  /** The issue's path inside the manifest, such as `steps.2.env.TOKEN`. */
  readonly path: string;
}

/**
 * Points an inner issue at the step that uses the composite, and names the
 * manifest file and line in the message. An issue a nested composite already
 * located keeps its location.
 */
function locateInnerIssue(
  innerIssue: WorkflowModelValidationIssue,
  params: {
    uses: string;
    composite: ResolvedCompositeAction;
    sourceName: string;
    callerPath: readonly WorkflowModelValidationIssuePathSegment[];
  },
): WorkflowModelValidationIssue {
  if (innerIssue.details?.composite !== undefined) {
    return {...innerIssue, path: params.callerPath};
  }
  const [jobs, job, steps, index, ...rest] = innerIssue.path;
  const isStepPath =
    jobs === 'jobs' && job === params.sourceName && steps === 'steps' && typeof index === 'number';
  const innerPath = isStepPath ? ['steps', index, ...rest] : innerIssue.path;
  const line = isStepPath ? params.composite.stepLocations.get(index)?.startLine : undefined;
  const location: CompositeIssueLocation = {
    uses: params.uses,
    file: params.composite.manifestPath,
    ...(line === undefined ? {} : {line}),
    path: innerPath.join('.'),
  };
  return {
    ...innerIssue,
    path: params.callerPath,
    message: `${location.file}${line === undefined ? '' : `:${line}`}: ${innerIssue.message}`,
    details: {...innerIssue.details, composite: location},
  };
}

function referencesSecrets(value: unknown): boolean {
  let found = false;
  forEachStringLeaf(value, [], (leaf) => {
    if (found || !leaf.includes('$' + '{{')) return;
    try {
      found = parseWorkflowTemplate(leaf).some(
        (segment) => segment.kind === 'expr' && segment.contextRoots.includes('secrets'),
      );
    } catch {
      // The normalization of the field reports the template error.
    }
  });
  return found;
}

function forEachStringLeaf(
  value: unknown,
  path: readonly WorkflowModelValidationIssuePathSegment[],
  visit: (value: string, path: readonly WorkflowModelValidationIssuePathSegment[]) => void,
  seen: Set<object> = new Set(),
): void {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    forEachStringLeaf(child, [...path, Array.isArray(value) ? Number(key) : key], visit, seen);
  }
}

// YAML aliases can share objects between fields, so each object is copied once.
function mapStringLeaves(
  value: unknown,
  map: (value: string) => string,
  copies: Map<object, unknown> = new Map(),
): unknown {
  if (typeof value === 'string') return map(value);
  if (typeof value !== 'object' || value === null) return value;
  const existing = copies.get(value);
  if (existing !== undefined) return existing;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (const child of value) copy.push(mapStringLeaves(child, map, copies));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  copies.set(value, copy);
  for (const [key, child] of Object.entries(value)) {
    copy[key] = mapStringLeaves(child, map, copies);
  }
  return copy;
}
