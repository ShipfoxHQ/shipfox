import {type ASTNode, type BinaryOperator, parse as parseCel} from '@marcbachmann/cel-js';

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

export function extractExactContextRoots(source: string): string[] {
  const roots = new Set<string>();
  collectExactContextRoots(parseCel(source).ast, roots, new Set());
  return [...roots].sort();
}

function collectExactContextRoots(
  node: ASTNode,
  roots: Set<string>,
  scopedIdentifiers: ReadonlySet<string>,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryExactContextRoots(node.args as [ASTNode, ASTNode], roots, scopedIdentifiers);
    return;
  }

  switch (node.op) {
    case 'id':
      if (!scopedIdentifiers.has(node.args)) roots.add(node.args);
      return;
    case 'value':
      return;
    case '.':
    case '.?':
      collectExactContextRoots(node.args[0], roots, scopedIdentifiers);
      return;
    case '[]':
    case '[?]':
      collectBinaryExactContextRoots(node.args, roots, scopedIdentifiers);
      return;
    case 'call':
      for (const argument of node.args[1]) {
        collectExactContextRoots(argument, roots, scopedIdentifiers);
      }
      return;
    case 'rcall': {
      const [method, receiver, args] = node.args as [string, ASTNode, ASTNode[]];
      collectExactContextRoots(receiver, roots, scopedIdentifiers);
      const binding = bindComprehensionAlias(method, args, scopedIdentifiers);
      for (const argument of args.slice(binding.skipArgs)) {
        collectExactContextRoots(argument, roots, binding.scopedIdentifiers);
      }
      return;
    }
    case 'list':
      for (const element of node.args) {
        collectExactContextRoots(element, roots, scopedIdentifiers);
      }
      return;
    case 'map':
      for (const [key, value] of node.args) {
        collectMapKeyExactContextRoots(key, roots, scopedIdentifiers);
        collectExactContextRoots(value, roots, scopedIdentifiers);
      }
      return;
    case '?:':
      collectExactContextRoots(node.args[0], roots, scopedIdentifiers);
      collectExactContextRoots(node.args[1], roots, scopedIdentifiers);
      collectExactContextRoots(node.args[2], roots, scopedIdentifiers);
      return;
    case '!_':
    case '-_':
      collectExactContextRoots(node.args, roots, scopedIdentifiers);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectBinaryExactContextRoots(
  [left, right]: [ASTNode, ASTNode],
  roots: Set<string>,
  scopedIdentifiers: ReadonlySet<string>,
): void {
  collectExactContextRoots(left, roots, scopedIdentifiers);
  collectExactContextRoots(right, roots, scopedIdentifiers);
}

function collectMapKeyExactContextRoots(
  key: ASTNode,
  roots: Set<string>,
  scopedIdentifiers: ReadonlySet<string>,
): void {
  if (key.op === 'id') return;
  collectExactContextRoots(key, roots, scopedIdentifiers);
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
