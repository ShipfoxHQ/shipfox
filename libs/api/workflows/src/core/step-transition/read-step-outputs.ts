import {type OutputDeclarations, outputTypes} from '@shipfox/expression';

const outputTypeSet = new Set<string>(outputTypes);

export function readStepOutputs(config: Record<string, unknown>): OutputDeclarations | undefined {
  const outputs = config.outputs;
  if (!isRecord(outputs)) return undefined;

  const declarations: Record<string, {type: (typeof outputTypes)[number]; schema?: unknown}> =
    Object.create(null) as Record<string, {type: (typeof outputTypes)[number]; schema?: unknown}>;

  for (const [key, declaration] of Object.entries(outputs)) {
    if (!isRecord(declaration)) return undefined;
    const type = declaration.type;
    if (typeof type !== 'string' || !outputTypeSet.has(type)) return undefined;
    declarations[key] = {
      type: type as (typeof outputTypes)[number],
      ...(!Object.hasOwn(declaration, 'schema') ? {} : {schema: declaration.schema}),
    };
  }

  return declarations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
