import {access, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {coerceStepOutputs, type StepOutputCoercionError} from '@shipfox/expression';
import {type ActionManifest, actionManifestSchema} from '@shipfox/workflow-document';
import {parse} from 'yaml';
import type {ActionOutputDeclarations} from '#contract.js';
import {type ToolGrant, toolGrants} from '#generated/tool-grants.js';

export class ActionTestSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionTestSetupError';
  }
}

export interface GrantedIntegration {
  readonly allowWrite: boolean;
  /** Tools granted with every method, by tool id. */
  readonly tools: ReadonlyMap<string, ToolGrant>;
  /** Single granted methods, by `family.method`. */
  readonly methods: ReadonlyMap<string, ToolGrant>;
}

// The server's manifest names, in order of preference.
const ACTION_MANIFEST_FILE_NAMES = ['action.yml', 'action.yaml'] as const;

export async function readActionManifest(actionDir: string): Promise<ActionManifest> {
  const path = await manifestPath(actionDir);
  let raw: unknown;
  try {
    raw = parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new ActionTestSetupError(`Cannot read ${path}: ${errorMessage(error)}`);
  }
  const result = actionManifestSchema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
  );
  throw new ActionTestSetupError(`Invalid action manifest ${path}:\n- ${issues.join('\n- ')}`);
}

async function manifestPath(actionDir: string): Promise<string> {
  for (const name of ACTION_MANIFEST_FILE_NAMES) {
    const path = join(actionDir, name);
    try {
      await access(path);
      return path;
    } catch {
      // Try the next name.
    }
  }
  return join(actionDir, ACTION_MANIFEST_FILE_NAMES[0]);
}

/** Applies defaults to omitted inputs and types every value, as the server does at dispatch. */
export function coerceActionInputs(
  manifest: ActionManifest,
  provided: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const declarations = manifest.inputs ?? {};
  const values: Record<string, unknown> = {...provided};
  for (const [name, input] of Object.entries(declarations)) {
    if (!Object.hasOwn(values, name) && input.default !== undefined) values[name] = input.default;
  }
  const result = coerceStepOutputs({declarations, output: values});
  if (result.ok) return result.output;
  throw new ActionTestSetupError(inputErrorMessage(result.error));
}

export function outputDeclarations(manifest: ActionManifest): ActionOutputDeclarations {
  return Object.fromEntries(
    Object.entries(manifest.outputs ?? {}).map(([name, {type, schema, required}]) => [
      name,
      {type, required, ...(schema === undefined ? {} : {schema})},
    ]),
  );
}

/**
 * Resolves each alias's `include` selectors against the provider catalog, as the server freezes
 * grants at run creation. An unknown provider or selector fails, as it fails the sync.
 */
export function resolveGrants(manifest: ActionManifest): ReadonlyMap<string, GrantedIntegration> {
  const grants = new Map<string, GrantedIntegration>();
  for (const [alias, integration] of Object.entries(manifest.integrations ?? {})) {
    const catalog = own(toolGrants, integration.provider);
    if (catalog === undefined) {
      throw new ActionTestSetupError(
        `Integration "${alias}" names provider "${integration.provider}", which has no tools.`,
      );
    }
    const tools = new Map<string, ToolGrant>();
    const methods = new Map<string, ToolGrant>();
    for (const selector of integration.include) {
      const tool = own(catalog, selector);
      if (tool !== undefined) {
        tools.set(selector, tool);
        continue;
      }
      const method = methodGrant((id) => own(catalog, id), selector);
      if (method === undefined) {
        throw new ActionTestSetupError(
          `Integration "${alias}" includes unknown ${integration.provider} tool ${selector}.`,
        );
      }
      methods.set(selector, method);
    }
    grants.set(alias, {allowWrite: integration.allow_write, tools, methods});
  }
  return grants;
}

/** The grant a call to `tool` uses: a whole tool, or one method of a family. */
export function findGrant(integration: GrantedIntegration, tool: string): ToolGrant | undefined {
  return (
    integration.tools.get(tool) ??
    integration.methods.get(tool) ??
    methodGrant((id) => integration.tools.get(id), tool)
  );
}

// `family.method` names one method of a family tool.
function methodGrant(
  family: (id: string) => ToolGrant | undefined,
  name: string,
): ToolGrant | undefined {
  const separator = name.indexOf('.');
  if (separator === -1) return undefined;
  const grant = family(name.slice(0, separator));
  const sensitivity = grant?.methods && own(grant.methods, name.slice(separator + 1));
  return grant === undefined || sensitivity === undefined
    ? undefined
    : {sensitivity, result: grant.result};
}

function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function inputErrorMessage(error: StepOutputCoercionError): string {
  const input = `Action input "${error.key}"`;
  switch (error.reason) {
    case 'missing':
      return `${input} is required.`;
    case 'undeclared':
      return `${input} is not declared by the action.`;
    case 'invalid_json':
      return `${input} must be valid JSON.`;
    case 'schema_invalid':
      return `${input} does not match its JSON Schema: ${error.schemaError ?? 'invalid value'}.`;
    case 'invalid_type':
      return `${input} must be a ${error.expectedType ?? 'valid'} value.`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
