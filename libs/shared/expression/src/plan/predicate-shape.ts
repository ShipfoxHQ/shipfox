import {type ASTNode, type BinaryOperator, parse as parseCel} from '@marcbachmann/cel-js';

const comparisonOperators = new Set<BinaryOperator>(['!=', '==', 'in', '<', '<=', '>', '>=']);
const booleanReturningCalls = new Set([
  'all',
  'contains',
  'endsWith',
  'exists',
  'exists_one',
  'matches',
  'startsWith',
]);

export function predicateSourceIsBooleanShaped(source: string): boolean {
  try {
    return nodeIsBooleanShaped(parseCel(source).ast);
  } catch {
    return false;
  }
}

function nodeIsBooleanShaped(node: ASTNode): boolean {
  if (comparisonOperators.has(node.op as BinaryOperator)) return true;
  if (node.op === '&&' || node.op === '||' || node.op === '!_') return true;

  switch (node.op) {
    case 'value':
      return typeof node.args === 'boolean';
    case 'call':
      return booleanReturningCalls.has(node.args[0]);
    case 'rcall':
      return booleanReturningCalls.has(node.args[0]);
    case '?:':
      return nodeIsBooleanShaped(node.args[1]) && nodeIsBooleanShaped(node.args[2]);
    default:
      return false;
  }
}
