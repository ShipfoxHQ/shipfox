import {
  type OutputDeclarations,
  type OutputTypeDeclaration,
  outputTypes,
} from '@shipfox/expression';

const outputTypeSet = new Set<string>(outputTypes);

export function readStepOutputs(config: Record<string, unknown>): OutputDeclarations | undefined {
  const outputs = config.outputs;
  if (!isRecord(outputs)) return undefined;

  const declarations = Object.create(null) as Record<string, OutputTypeDeclaration>;

  for (const [key, declaration] of Object.entries(outputs)) {
    if (!isRecord(declaration)) return undefined;
    const type = declaration.type;
    if (typeof type !== 'string' || !outputTypeSet.has(type)) return undefined;
    const required = declaration.required;
    if (required !== undefined && typeof required !== 'boolean') return undefined;
    declarations[key] = {
      type: type as OutputTypeDeclaration['type'],
      ...(!Object.hasOwn(declaration, 'schema') ? {} : {schema: declaration.schema}),
      ...(required === undefined ? {} : {required}),
    };
  }

  return declarations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
