import {
  coerceStepOutputs,
  type OutputDeclarations,
  type OutputTypeDeclaration,
  type StepOutputCoercionError,
} from '@shipfox/expression';
import {
  MAX_OUTPUT_TOTAL_BYTES,
  MAX_OUTPUT_VALUE_BYTES,
  OUTPUT_KEY_REGEX,
} from '@shipfox/runner-execution/step-output';

export type SetOutputResult = {readonly ok: true} | {readonly ok: false; readonly feedback: string};

export const MAX_OUTPUT_REPROMPTS = 2;

export class RequiredOutputsMissingError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(`Agent step finished without required outputs: ${missing.join(', ')}`);
    this.name = 'RequiredOutputsMissingError';
  }
}

export class OutputCollector {
  readonly #declarations: OutputDeclarations | undefined;
  readonly #outputs: Record<string, string> = {};

  constructor(declarations: OutputDeclarations | undefined) {
    this.#declarations = declarations;
  }

  trySet(key: string, value: string): SetOutputResult {
    const keyResult = this.#validateKey(key);
    if (!keyResult.ok) return keyResult;

    if (Buffer.byteLength(value, 'utf8') > MAX_OUTPUT_VALUE_BYTES) {
      return {
        ok: false,
        feedback: `Output "${key}" exceeds the per-value size limit of ${MAX_OUTPUT_VALUE_BYTES} bytes.`,
      };
    }

    const totalBytes = totalOutputBytes({...this.#outputs, [key]: value});
    if (totalBytes > MAX_OUTPUT_TOTAL_BYTES) {
      return {
        ok: false,
        feedback: `Step outputs exceed the total size limit of ${MAX_OUTPUT_TOTAL_BYTES} bytes.`,
      };
    }

    const declaration = this.#declarations?.[key];
    if (declaration !== undefined) {
      const coerced = coerceSingleOutput(key, declaration, value);
      if (!coerced.ok) return {ok: false, feedback: feedbackForCoercionError(coerced.error)};
    }

    this.#outputs[key] = value;
    return {ok: true};
  }

  missingRequired(): string[] {
    if (this.#declarations === undefined) return [];
    return Object.keys(this.#declarations).filter((key) => !Object.hasOwn(this.#outputs, key));
  }

  snapshot(): Record<string, string> {
    return {...this.#outputs};
  }

  guidanceText(): string {
    return outputGuidanceText(this.#declarations);
  }

  #validateKey(key: string): SetOutputResult {
    if (!OUTPUT_KEY_REGEX.test(key)) {
      return {
        ok: false,
        feedback:
          `Output key "${key}" is invalid. Use letters, numbers, underscores, or hyphens, ` +
          'and start with a letter or underscore.',
      };
    }

    if (this.#declarations !== undefined && !Object.hasOwn(this.#declarations, key)) {
      return {
        ok: false,
        feedback: `Output "${key}" is not declared by the step output schema.`,
      };
    }

    return {ok: true};
  }
}

export async function runOutputTurnLoop(params: {
  signal: AbortSignal;
  prompt: string;
  runTurn: (prompt: string) => Promise<void>;
  missingRequired: () => string[];
}): Promise<void> {
  let nextPrompt = params.prompt;
  for (let attempt = 0; attempt <= MAX_OUTPUT_REPROMPTS; attempt += 1) {
    if (params.signal.aborted) throw new Error('Agent step aborted');
    await params.runTurn(nextPrompt);
    if (params.signal.aborted) throw new Error('Agent step aborted');
    const missing = params.missingRequired();
    if (missing.length === 0) return;
    if (attempt === MAX_OUTPUT_REPROMPTS) {
      throw new RequiredOutputsMissingError(missing);
    }
    nextPrompt =
      `The previous turn ended without setting required workflow outputs: ${missing.join(', ')}. ` +
      'Call set_output for each missing key, then provide your final response.';
  }
}

export function outputGuidanceText(declarations: OutputDeclarations | undefined): string {
  const base =
    'Use the set_output tool to report step outputs. The tool takes key and value strings. ' +
    'For json outputs, pass value as JSON text.';
  if (declarations === undefined) {
    return `${base} This step has no declared output schema, so any valid output key is accepted.`;
  }

  const lines = Object.entries(declarations).map(([key, declaration]) => {
    const schema =
      declaration.schema === undefined ? '' : '; value must satisfy the declared JSON schema';
    return `- ${key}: ${declaration.type}${declaration.type === 'json' ? ' as JSON text' : ''}${schema}`;
  });

  return `${base} This step requires these outputs before finishing:\n${lines.join('\n')}`;
}

export function withOutputGuidance(prompt: string, guidance: string): string {
  return `${prompt}\n\n${guidance}`;
}

function coerceSingleOutput(
  key: string,
  declaration: OutputTypeDeclaration,
  value: string,
): ReturnType<typeof coerceStepOutputs> {
  return coerceStepOutputs({declarations: {[key]: declaration}, output: {[key]: value}});
}

function feedbackForCoercionError(error: StepOutputCoercionError): string {
  return error.message;
}

function totalOutputBytes(outputs: Record<string, string>): number {
  return Object.entries(outputs).reduce(
    (total, [key, value]) => total + Buffer.byteLength(`${key}=${value}\n`, 'utf8'),
    0,
  );
}
