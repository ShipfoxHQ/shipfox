import {type ASTNode, parse as parseCel} from '@marcbachmann/cel-js';

/** Expression functions that the runner computes when the step starts. */
export const runnerCallFunctions = ['hashFiles'] as const;
export type RunnerCallFunction = (typeof runnerCallFunctions)[number];

/** CEL has no variadic functions, so `hashFiles()` is declared once per arity up to this one. */
export const HASH_FILES_MAX_PATTERNS = 16;

export interface RunnerCall {
  readonly function: RunnerCallFunction;
  readonly patterns: readonly string[];
}

export type RunnerCallAnalysis =
  | {readonly kind: 'none'}
  | {readonly kind: 'bare'; readonly call: RunnerCall}
  | {readonly kind: 'not-bare'; readonly function: RunnerCallFunction}
  | {readonly kind: 'argument-not-literal'; readonly function: RunnerCallFunction}
  | {readonly kind: 'arity'; readonly function: RunnerCallFunction};

/**
 * Finds runner-computed calls in an expression. Only a whole expression that is one call with
 * string literal arguments can be planned, because the runner evaluates no CEL: it receives the
 * call's arguments as data.
 */
export function analyzeRunnerCalls(source: string): RunnerCallAnalysis {
  let ast: ASTNode;
  try {
    ast = parseCel(source).ast;
  } catch {
    return {kind: 'none'};
  }

  const call = runnerCallOf(ast);
  if (call !== undefined) {
    if (call.args.length === 0 || call.args.length > HASH_FILES_MAX_PATTERNS) {
      return {kind: 'arity', function: call.function};
    }
    const patterns = literalStringArguments(call.args);
    if (patterns === undefined) return {kind: 'argument-not-literal', function: call.function};
    return {kind: 'bare', call: {function: call.function, patterns}};
  }

  const nested = findRunnerCall(ast);
  return nested === undefined ? {kind: 'none'} : {kind: 'not-bare', function: nested};
}

export function referencesRunnerCall(source: string): boolean {
  return analyzeRunnerCalls(source).kind !== 'none';
}

function runnerCallOf(
  node: ASTNode,
): {readonly function: RunnerCallFunction; readonly args: readonly ASTNode[]} | undefined {
  if (node.op !== 'call') return undefined;
  const [name, args] = node.args as [string, ASTNode[]];
  if (!isRunnerCallFunction(name)) return undefined;
  return {function: name, args};
}

function literalStringArguments(args: readonly ASTNode[]): string[] | undefined {
  const values: string[] = [];
  for (const argument of args) {
    if (argument.op !== 'value' || typeof argument.args !== 'string') return undefined;
    values.push(argument.args);
  }
  return values;
}

function findRunnerCall(node: unknown): RunnerCallFunction | undefined {
  if (Array.isArray(node)) {
    for (const element of node) {
      const found = findRunnerCall(element);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isAstNode(node)) return undefined;
  if (node.op === 'call') {
    const [name] = node.args as [string, ASTNode[]];
    if (isRunnerCallFunction(name)) return name;
  }
  if (node.op === 'value' || node.op === 'id') return undefined;
  return findRunnerCall(node.args);
}

function isAstNode(value: unknown): value is ASTNode {
  return typeof value === 'object' && value !== null && 'op' in value && 'args' in value;
}

function isRunnerCallFunction(name: string): name is RunnerCallFunction {
  return (runnerCallFunctions as readonly string[]).includes(name);
}
