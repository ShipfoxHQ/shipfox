export type ExprIR = BinaryExprIR | RefExprIR | IntLiteralExprIR;

export type BinaryExprIR = Readonly<{
  kind: 'binary';
  op: '==';
  left: ExprIR;
  right: ExprIR;
}>;

export type RefExprIR = Readonly<{
  kind: 'ref';
  path: readonly string[];
}>;

export type IntLiteralExprIR = Readonly<{
  kind: 'int';
  value: number;
}>;

export type DefaultRunExitCodeAcceptancePolicyIR = Readonly<{
  kind: 'default_run_exit_code';
  successIf: ExprIR;
}>;

export type AcceptancePolicyIR = DefaultRunExitCodeAcceptancePolicyIR;

export function createDefaultRunExitCodeAcceptancePolicy(): DefaultRunExitCodeAcceptancePolicyIR {
  return {
    kind: 'default_run_exit_code',
    successIf: {
      kind: 'binary',
      op: '==',
      left: {kind: 'ref', path: ['output', 'exit_code']},
      right: {kind: 'int', value: 0},
    },
  };
}
