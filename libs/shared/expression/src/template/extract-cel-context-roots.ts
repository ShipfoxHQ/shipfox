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

export function extractCelContextRoots(source: string): string[] {
  const contextRoots = new Set<string>();
  collectContextRoots(parseCel(source).ast, contextRoots);
  return [...contextRoots].sort();
}

function collectContextRoots(node: ASTNode, contextRoots: Set<string>): void {
  if (binaryOperators.has(node.op as BinaryOperator) || node.op === '||' || node.op === '&&') {
    collectBinaryContextRoots(node.args as [ASTNode, ASTNode], contextRoots);
    return;
  }

  switch (node.op) {
    case 'id':
      contextRoots.add(node.args);
      return;
    case 'value':
      return;
    case '.':
    case '.?':
      collectContextRoots(node.args[0], contextRoots);
      return;
    case '[]':
    case '[?]':
      collectBinaryContextRoots(node.args, contextRoots);
      return;
    case 'call':
      for (const argument of node.args[1]) collectContextRoots(argument, contextRoots);
      return;
    case 'rcall':
      collectContextRoots(node.args[1], contextRoots);
      for (const argument of node.args[2]) collectContextRoots(argument, contextRoots);
      return;
    case 'list':
      for (const element of node.args) collectContextRoots(element, contextRoots);
      return;
    case 'map':
      for (const [key, value] of node.args) {
        collectContextRoots(key, contextRoots);
        collectContextRoots(value, contextRoots);
      }
      return;
    case '?:':
      collectContextRoots(node.args[0], contextRoots);
      collectContextRoots(node.args[1], contextRoots);
      collectContextRoots(node.args[2], contextRoots);
      return;
    case '!_':
    case '-_':
      collectContextRoots(node.args, contextRoots);
      return;
  }

  throw new Error(`Unsupported CEL AST operator: ${(node as {op: string}).op}`);
}

function collectBinaryContextRoots(
  [left, right]: [ASTNode, ASTNode],
  contextRoots: Set<string>,
): void {
  collectContextRoots(left, contextRoots);
  collectContextRoots(right, contextRoots);
}
