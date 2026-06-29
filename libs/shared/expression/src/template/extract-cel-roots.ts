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

export function extractCelRoots(source: string): string[] {
  const roots = new Set<string>();
  collectRoots(parseCel(source).ast, roots);
  return [...roots].sort();
}

function collectRoots(node: ASTNode, roots: Set<string>): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryRoots(node.args as [ASTNode, ASTNode], roots);
    return;
  }

  switch (node.op) {
    case 'id':
      roots.add(node.args);
      return;
    case 'value':
      return;
    case '.':
    case '.?':
      collectRoots(node.args[0], roots);
      return;
    case '[]':
    case '[?]':
      collectBinaryRoots(node.args, roots);
      return;
    case 'call':
      for (const argument of node.args[1]) collectRoots(argument, roots);
      return;
    case 'rcall':
      collectRoots(node.args[1], roots);
      for (const argument of node.args[2]) collectRoots(argument, roots);
      return;
    case 'list':
      for (const element of node.args) collectRoots(element, roots);
      return;
    case 'map':
      for (const [key, value] of node.args) {
        collectRoots(key, roots);
        collectRoots(value, roots);
      }
      return;
    case '?:':
      collectRoots(node.args[0], roots);
      collectRoots(node.args[1], roots);
      collectRoots(node.args[2], roots);
      return;
    case '!_':
    case '-_':
      collectRoots(node.args, roots);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectBinaryRoots([left, right]: [ASTNode, ASTNode], roots: Set<string>): void {
  collectRoots(left, roots);
  collectRoots(right, roots);
}
