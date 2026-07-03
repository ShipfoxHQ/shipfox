import {type ASTNode, parse as parseCel} from '@marcbachmann/cel-js';

export function isBareContextReference(source: string): boolean {
  try {
    return bareMemberAccessDepth(parseCel(source).ast) > 0;
  } catch {
    return false;
  }
}

function bareMemberAccessDepth(node: ASTNode): number {
  switch (node.op) {
    case 'id':
      return 0;
    case '.': {
      const targetDepth = bareMemberAccessDepth(node.args[0]);
      return targetDepth >= 0 ? targetDepth + 1 : -1;
    }
    default:
      return -1;
  }
}
