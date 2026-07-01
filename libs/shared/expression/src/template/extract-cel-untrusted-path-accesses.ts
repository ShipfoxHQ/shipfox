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

export function extractCelUntrustedPathAccesses(params: {
  source: string;
  untrustedPathsByRoot: ReadonlyMap<string, readonly string[]>;
}): string[] {
  const roots = new Set<string>();
  collectUntrustedPathAccesses(parseCel(params.source).ast, params.untrustedPathsByRoot, roots);
  return [...roots].sort();
}

function collectUntrustedPathAccesses(
  node: ASTNode,
  untrustedPathsByRoot: ReadonlyMap<string, readonly string[]>,
  roots: Set<string>,
): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryUntrustedPathAccesses(
      node.args as [ASTNode, ASTNode],
      untrustedPathsByRoot,
      roots,
    );
    return;
  }

  switch (node.op) {
    case 'id':
    case 'value':
      return;
    case '.':
    case '.?': {
      const [target, field] = node.args as [ASTNode, string];
      collectUntrustedPathAccesses(target, untrustedPathsByRoot, roots);
      const root = rootName(target);
      if (root && untrustedPathsByRoot.get(root)?.includes(field)) roots.add(root);
      return;
    }
    case '[]':
    case '[?]': {
      const [target, key] = node.args as [ASTNode, ASTNode];
      collectUntrustedPathAccesses(target, untrustedPathsByRoot, roots);
      collectUntrustedPathAccesses(key, untrustedPathsByRoot, roots);
      const root = rootName(target);
      if (!root || !untrustedPathsByRoot.has(root)) return;

      const field = literalFieldName(key);
      if (field !== undefined) {
        if (untrustedPathsByRoot.get(root)?.includes(field)) roots.add(root);
        return;
      }

      if (!isAllowedListIndex(target, root)) roots.add(root);
      return;
    }
    case 'call':
      for (const argument of node.args[1]) {
        collectUntrustedPathAccesses(argument, untrustedPathsByRoot, roots);
      }
      return;
    case 'rcall':
      collectUntrustedPathAccesses(node.args[1], untrustedPathsByRoot, roots);
      for (const argument of node.args[2]) {
        collectUntrustedPathAccesses(argument, untrustedPathsByRoot, roots);
      }
      return;
    case 'list':
      for (const element of node.args) {
        collectUntrustedPathAccesses(element, untrustedPathsByRoot, roots);
      }
      return;
    case 'map':
      for (const [key, value] of node.args) {
        collectUntrustedPathAccesses(key, untrustedPathsByRoot, roots);
        collectUntrustedPathAccesses(value, untrustedPathsByRoot, roots);
      }
      return;
    case '?:':
      collectUntrustedPathAccesses(node.args[0], untrustedPathsByRoot, roots);
      collectUntrustedPathAccesses(node.args[1], untrustedPathsByRoot, roots);
      collectUntrustedPathAccesses(node.args[2], untrustedPathsByRoot, roots);
      return;
    case '!_':
    case '-_':
      collectUntrustedPathAccesses(node.args, untrustedPathsByRoot, roots);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectBinaryUntrustedPathAccesses(
  [left, right]: [ASTNode, ASTNode],
  untrustedPathsByRoot: ReadonlyMap<string, readonly string[]>,
  roots: Set<string>,
): void {
  collectUntrustedPathAccesses(left, untrustedPathsByRoot, roots);
  collectUntrustedPathAccesses(right, untrustedPathsByRoot, roots);
}

function rootName(node: ASTNode): string | undefined {
  switch (node.op) {
    case 'id':
      return node.args;
    case '.':
    case '.?':
      return rootName(node.args[0]);
    case '[]':
    case '[?]':
      return rootName(node.args[0]);
    default:
      return undefined;
  }
}

function literalFieldName(node: ASTNode): string | undefined {
  return node.op === 'value' && typeof node.args === 'string' ? node.args : undefined;
}

function isAllowedListIndex(target: ASTNode, root: string): boolean {
  return root === 'executions' && target.op === 'id';
}
