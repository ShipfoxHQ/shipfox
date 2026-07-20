import type {ZodType, z} from 'zod';

const KEBAB_CASE_ERROR_CODE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export type InterModuleErrorSchemas = Record<string, ZodType>;

export interface InterModuleMethodDefinition<
  Input extends ZodType = ZodType,
  Output extends ZodType = ZodType,
  Errors extends InterModuleErrorSchemas = InterModuleErrorSchemas,
> {
  input: Input;
  output: Output;
  errors?: Errors;
}

export interface InterModuleContractDefinition {
  module: string;
  methods: Record<string, InterModuleMethodDefinition>;
}

/**
 * One method's contract, carried by value so a client and a presentation can prove
 * (by object identity, not by name) that they were built from the same definition.
 */
export interface InterModuleMethodContract<
  Input extends ZodType = ZodType,
  Output extends ZodType = ZodType,
  Errors extends InterModuleErrorSchemas = InterModuleErrorSchemas,
> {
  readonly module: string;
  readonly method: string;
  readonly input: Input;
  readonly output: Output;
  readonly errors: Errors;
}

export type InterModuleContract<Def extends InterModuleContractDefinition> = {
  readonly module: Def['module'];
  readonly methods: {
    readonly [Method in keyof Def['methods'] & string]: InterModuleMethodContract<
      Def['methods'][Method]['input'],
      Def['methods'][Method]['output'],
      Def['methods'][Method]['errors'] extends InterModuleErrorSchemas
        ? Def['methods'][Method]['errors']
        : // biome-ignore lint/complexity/noBannedTypes: an empty error map is the correct shape for a method without declared errors.
          {}
    >;
  };
};

export type InterModuleMethodContractOf<
  Def extends InterModuleContractDefinition,
  Method extends keyof Def['methods'] & string,
> = InterModuleContract<Def>['methods'][Method];

/**
 * Declares one producer's inter-module contract: a stable module name plus, per
 * method, JSON-safe Zod input/output schemas and kebab-case known-error schemas.
 *
 * The returned contract is frozen and its per-method entries are distinct objects;
 * a transport seals a graph by comparing these objects by reference; a matching
 * module/method name pair from a different `defineInterModuleContract` call is a
 * mismatch, not a duplicate.
 */
export function defineInterModuleContract<const Def extends InterModuleContractDefinition>(
  def: Def,
): InterModuleContract<Def> {
  assertKebabCaseErrorCodes(def);

  const methods = {} as Record<string, InterModuleMethodContract>;
  for (const [method, definition] of Object.entries(def.methods)) {
    methods[method] = Object.freeze({
      module: def.module,
      method,
      input: definition.input,
      output: definition.output,
      errors: Object.freeze({...(definition.errors ?? {})}),
    });
  }
  return Object.freeze({
    module: def.module,
    methods: Object.freeze(methods),
  }) as InterModuleContract<Def>;
}

export type InferInterModuleErrorDetails<
  Method extends InterModuleMethodContract,
  Code extends keyof Method['errors'] & string,
> = z.output<Method['errors'][Code]>;

/**
 * Enforces the ADR's stable-name convention for known errors: a producer that
 * publishes `NotFound` or `not_found` instead of `not-found` weakens the one
 * cross-transport, exhaustive-switch convention every caller relies on. Rejected
 * at definition time so a bad code never reaches a client or a wire contract.
 */
function assertKebabCaseErrorCodes(def: InterModuleContractDefinition): void {
  const invalidCodes: string[] = [];
  for (const [method, definition] of Object.entries(def.methods)) {
    for (const code of Object.keys(definition.errors ?? {})) {
      if (!KEBAB_CASE_ERROR_CODE_RE.test(code)) {
        invalidCodes.push(`${def.module}.${method}: "${code}"`);
      }
    }
  }
  if (invalidCodes.length > 0) {
    throw new Error(
      `Inter-module error codes must be stable kebab-case names (e.g. "not-found"), got: ${invalidCodes.join(', ')}`,
    );
  }
}
