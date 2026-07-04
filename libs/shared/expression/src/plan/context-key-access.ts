import {type ASTNode, type BinaryOperator, parse as parseCel} from '@marcbachmann/cel-js';
import type {WorkflowExpression} from '../expression/workflow-expression.js';
import {workflowContextRootRequiresLiteralKey} from '../workflow-context/workflow-context.js';

const binaryOperators = new Set<BinaryOperator>([
  '!=',
  '==',
  'in',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '<=',
  '>',
  '>=',
]);

const comprehensionMethods = new Set(['all', 'exists', 'exists_one', 'filter', 'map']);

export interface ContextKeyAccessReference {
  readonly root: 'vars' | 'secrets';
  readonly store?: string;
  readonly key: string;
}

export interface ContextKeyAccessViolation {
  readonly root: string;
  readonly source: string;
}

export interface ContextKeyAccessAnalysis {
  readonly references: readonly ContextKeyAccessReference[];
  readonly violations: readonly ContextKeyAccessViolation[];
}

interface AccessChain {
  readonly root: string;
  readonly segments: readonly string[];
  readonly computed: boolean;
}

export function analyzeContextKeyAccess(
  expression: WorkflowExpression | string,
): ContextKeyAccessAnalysis {
  const source = typeof expression === 'string' ? expression : expression.source;
  const references: ContextKeyAccessReference[] = [];
  const violations: ContextKeyAccessViolation[] = [];

  collectContextKeyAccesses(parseCel(source).ast, source, references, violations, new Set());

  return {references, violations};
}

function collectContextKeyAccesses(
  node: ASTNode,
  source: string,
  references: ContextKeyAccessReference[],
  violations: ContextKeyAccessViolation[],
  scopedIdentifiers: ReadonlySet<string>,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryContextKeyAccesses(
      node.args as [ASTNode, ASTNode],
      source,
      references,
      violations,
      scopedIdentifiers,
    );
    return;
  }

  const chain = accessChain(node, scopedIdentifiers);
  if (chain && workflowContextRootRequiresLiteralKey(chain.root)) {
    recordLiteralKeyRootAccess(chain, source, references, violations);
    return;
  }

  switch (node.op) {
    case 'id':
    case 'value':
      return;
    case '.':
    case '.?':
      collectContextKeyAccesses(node.args[0], source, references, violations, scopedIdentifiers);
      return;
    case '[]':
    case '[?]':
      collectBinaryContextKeyAccesses(node.args, source, references, violations, scopedIdentifiers);
      return;
    case 'call':
      for (const argument of node.args[1]) {
        collectContextKeyAccesses(argument, source, references, violations, scopedIdentifiers);
      }
      return;
    case 'rcall': {
      const [method, receiver, args] = node.args as [string, ASTNode, ASTNode[]];
      collectContextKeyAccesses(receiver, source, references, violations, scopedIdentifiers);
      const binding = bindComprehensionAlias(method, args, scopedIdentifiers);
      for (const argument of args.slice(binding.skipArgs)) {
        collectContextKeyAccesses(
          argument,
          source,
          references,
          violations,
          binding.scopedIdentifiers,
        );
      }
      return;
    }
    case 'list':
      for (const element of node.args) {
        collectContextKeyAccesses(element, source, references, violations, scopedIdentifiers);
      }
      return;
    case 'map':
      for (const [key, value] of node.args) {
        if (key.op !== 'id') {
          collectContextKeyAccesses(key, source, references, violations, scopedIdentifiers);
        }
        collectContextKeyAccesses(value, source, references, violations, scopedIdentifiers);
      }
      return;
    case '?:':
      collectContextKeyAccesses(node.args[0], source, references, violations, scopedIdentifiers);
      collectContextKeyAccesses(node.args[1], source, references, violations, scopedIdentifiers);
      collectContextKeyAccesses(node.args[2], source, references, violations, scopedIdentifiers);
      return;
    case '!_':
    case '-_':
      collectContextKeyAccesses(node.args, source, references, violations, scopedIdentifiers);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectBinaryContextKeyAccesses(
  [left, right]: [ASTNode, ASTNode],
  source: string,
  references: ContextKeyAccessReference[],
  violations: ContextKeyAccessViolation[],
  scopedIdentifiers: ReadonlySet<string>,
): void {
  collectContextKeyAccesses(left, source, references, violations, scopedIdentifiers);
  collectContextKeyAccesses(right, source, references, violations, scopedIdentifiers);
}

function recordLiteralKeyRootAccess(
  chain: AccessChain,
  source: string,
  references: ContextKeyAccessReference[],
  violations: ContextKeyAccessViolation[],
): void {
  if (chain.computed) {
    violations.push({root: chain.root, source});
    return;
  }

  if (chain.root === 'vars' && chain.segments.length === 1) {
    const key = chain.segments[0];
    if (key === undefined) throw new Error('Expected vars key segment');
    references.push({root: chain.root, key});
    return;
  }

  if (chain.root === 'secrets' && chain.segments.length === 1) {
    const key = chain.segments[0];
    if (key === undefined) throw new Error('Expected secret key segment');
    references.push({root: chain.root, key});
    return;
  }

  if (chain.root === 'secrets' && chain.segments.length === 2) {
    const store = chain.segments[0];
    const key = chain.segments[1];
    if (store === undefined || key === undefined) {
      throw new Error('Expected secret store and key segments');
    }
    references.push({root: chain.root, store, key});
    return;
  }

  violations.push({root: chain.root, source});
}

function accessChain(
  node: ASTNode,
  scopedIdentifiers: ReadonlySet<string>,
): AccessChain | undefined {
  switch (node.op) {
    case 'id':
      return scopedIdentifiers.has(node.args)
        ? undefined
        : {root: node.args, segments: [], computed: false};
    case '.': {
      const target = accessChain(node.args[0], scopedIdentifiers);
      if (target === undefined) return undefined;
      return {...target, segments: [...target.segments, node.args[1]]};
    }
    case '.?': {
      const target = accessChain(node.args[0], scopedIdentifiers);
      if (target === undefined) return undefined;
      return {...target, segments: [...target.segments, node.args[1]], computed: true};
    }
    case '[]':
    case '[?]': {
      const target = accessChain(node.args[0], scopedIdentifiers);
      if (target === undefined) return undefined;
      const literalSegment = literalStringValue(node.args[1]);
      return {
        ...target,
        segments:
          literalSegment === undefined ? target.segments : [...target.segments, literalSegment],
        computed: true,
      };
    }
    default:
      return undefined;
  }
}

function literalStringValue(node: ASTNode): string | undefined {
  return node.op === 'value' && typeof node.args === 'string' ? node.args : undefined;
}

function bindComprehensionAlias(
  method: string,
  args: readonly ASTNode[],
  scopedIdentifiers: ReadonlySet<string>,
): {readonly scopedIdentifiers: ReadonlySet<string>; readonly skipArgs: number} {
  if (!comprehensionMethods.has(method)) return {scopedIdentifiers, skipArgs: 0};

  const [alias] = args;
  if (alias?.op !== 'id') return {scopedIdentifiers, skipArgs: 0};

  return {
    scopedIdentifiers: new Set([...scopedIdentifiers, alias.args]),
    skipArgs: 1,
  };
}
