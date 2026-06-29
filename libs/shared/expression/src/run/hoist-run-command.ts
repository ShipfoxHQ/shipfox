import type {WorkflowExpressionEvaluationContext} from '../evaluator/evaluate-workflow-expression.js';
import {
  resolveWorkflowTemplate,
  type WorkflowTemplateDiagnostic,
} from '../resolver/resolve-workflow-template.js';
import type {
  WorkflowTemplateExprSegment,
  WorkflowTemplateSegment,
} from '../template/template-segment.js';
import {
  classifyShellSite,
  initialShellScanState,
  type ShellScanState,
  type ShellSiteContext,
  type ShellUnsafeRegion,
  scanShellLiteral,
} from './shell-quoting.js';

export const unsafeRunInterpolationErrorCode = 'unsafe-run-interpolation';

const generatedNamePrefix = '__sf_';
const shellIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface RunCommandOptions {
  readonly reservedNames?: Iterable<string>;
  readonly requiredContextRoots?: readonly string[];
}

export interface ResolvedRunCommand {
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
}

interface RunCommandBinding {
  readonly name: string;
  readonly segment: WorkflowTemplateExprSegment;
}

interface HoistedRunCommand {
  readonly command: string;
  readonly bindings: readonly RunCommandBinding[];
}

export class UnsafeRunInterpolationError extends Error {
  readonly code = unsafeRunInterpolationErrorCode;
  readonly region: ShellUnsafeRegion;
  readonly source: string;

  constructor(params: {readonly region: ShellUnsafeRegion; readonly source: string}) {
    super(
      `Unsafe run interpolation inside ${params.region}. Bind the value to env and reference $VAR instead.`,
    );
    this.name = 'UnsafeRunInterpolationError';
    this.region = params.region;
    this.source = params.source;
  }
}

export function resolveRunCommand(
  segments: readonly WorkflowTemplateSegment[],
  context: WorkflowExpressionEvaluationContext,
  options: RunCommandOptions = {},
): ResolvedRunCommand {
  const hoisted = hoistRunCommand(segments, options);
  const env: Record<string, string> = {};
  const diagnostics: WorkflowTemplateDiagnostic[] = [];

  for (const binding of hoisted.bindings) {
    const resolutionOptions =
      options.requiredContextRoots === undefined
        ? undefined
        : {requiredContextRoots: options.requiredContextRoots};
    const resolution = resolveWorkflowTemplate([binding.segment], context, resolutionOptions);
    env[binding.name] = resolution.value;
    diagnostics.push(...resolution.diagnostics);
  }

  return {command: hoisted.command, env, diagnostics};
}

export function hoistRunCommand(
  segments: readonly WorkflowTemplateSegment[],
  options: RunCommandOptions = {},
): HoistedRunCommand {
  let command = '';
  let state: ShellScanState = initialShellScanState;
  const bindings: RunCommandBinding[] = [];
  const reservedNames = new Set(options.reservedNames ?? []);
  let nextIndex = 0;

  for (const segment of segments) {
    if (segment.kind === 'literal') {
      command += segment.text;
      state = scanShellLiteral(segment.text, state);
      continue;
    }

    const site = classifyShellSite(state);
    if (site.kind === 'unsafe') {
      throw new UnsafeRunInterpolationError({
        region: site.region,
        source: segment.expression.source,
      });
    }

    const name = nextGeneratedName(reservedNames, nextIndex);
    nextIndex = Number(name.slice(generatedNamePrefix.length)) + 1;
    reservedNames.add(name);
    bindings.push({name, segment});
    command += shellReference(name, site);
  }

  return {command, bindings};
}

function nextGeneratedName(reservedNames: ReadonlySet<string>, startIndex: number): string {
  let index = startIndex;

  while (true) {
    const name = `${generatedNamePrefix}${index}`;
    if (!shellIdentifierPattern.test(name)) {
      throw new Error(`Generated run env name is not a shell identifier: ${name}`);
    }

    if (!reservedNames.has(name)) return name;
    index += 1;
  }
}

function shellReference(name: string, site: Exclude<ShellSiteContext, {readonly kind: 'unsafe'}>) {
  if (site.kind === 'double') return `\${${name}}`;
  if (site.kind === 'single') return `'"\${${name}}"'`;
  return `"\${${name}}"`;
}
