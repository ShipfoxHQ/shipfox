import {
  createDefaultRunExitCodeAcceptancePolicy,
  type DefaultRunExitCodeAcceptancePolicyIR,
  type ExprIR,
} from './expression-ir.js';

export type ExpressionSupportStatus = 'included' | 'deferred';

export type ExpressionSupportReference = Readonly<{
  concept: string;
  status: ExpressionSupportStatus;
  owner: string;
  pr1Behavior: string;
  nextRequiredWork: string;
}>;

export type DefaultAcceptanceExpressionReference = Readonly<{
  policyKind: DefaultRunExitCodeAcceptancePolicyIR['kind'];
  expression: string;
  expressionTree: DefaultRunExitCodeAcceptancePolicyIR['successIf'];
  notes: string;
}>;

const defaultRunExitCodeAcceptancePolicy = createDefaultRunExitCodeAcceptancePolicy();
const defaultRunExitCodeExpression = renderExprIR(defaultRunExitCodeAcceptancePolicy.successIf);

export const defaultAcceptanceExpressionReference: DefaultAcceptanceExpressionReference = {
  policyKind: 'default_run_exit_code',
  expression: defaultRunExitCodeExpression,
  expressionTree: defaultRunExitCodeAcceptancePolicy.successIf,
  notes:
    'PR1 names this built-in policy in IR instead of accepting an author-provided expression string.',
};

export const expressionSupportReference: readonly ExpressionSupportReference[] = [
  {
    concept: 'Default run-step success policy',
    status: 'included',
    owner: 'libs/api/workflow-language/src/core/ir/expression-ir.ts',
    pr1Behavior: `\`createDefaultRunExitCodeAcceptancePolicy()\` produces a typed \`${defaultRunExitCodeExpression}\` expression tree.`,
    nextRequiredWork:
      'Keep generated docs and normalizer tests aligned when the built-in policy changes.',
  },
  {
    concept: 'Custom expression parser',
    status: 'deferred',
    owner: 'deferred',
    pr1Behavior: 'No author-provided expression string is accepted or parsed.',
    nextRequiredWork: 'Add grammar, parser, AST tests, parse diagnostics, and generated docs.',
  },
  {
    concept: 'Expression typechecking',
    status: 'deferred',
    owner: 'deferred',
    pr1Behavior: 'No expression type environment exists for runner facts.',
    nextRequiredWork:
      'Define runner fact schemas and static diagnostics before accepting custom expressions.',
  },
  {
    concept: 'Runtime expression evaluator',
    status: 'deferred',
    owner: 'deferred',
    pr1Behavior: 'Runtime status is reported by job orchestration and runner completion paths.',
    nextRequiredWork:
      'Add a deterministic evaluator over typed runner facts and golden runtime traces.',
  },
  {
    concept: 'Structured runner command facts',
    status: 'deferred',
    owner: 'deferred',
    pr1Behavior:
      'The runner contract does not provide typed command facts for expression evaluation.',
    nextRequiredWork:
      'Extend runner DTOs and persistence before evaluating expressions against command output.',
  },
];

export function renderExprIR(expr: ExprIR): string {
  switch (expr.kind) {
    case 'binary':
      return `${renderExprIR(expr.left)} ${expr.op} ${renderExprIR(expr.right)}`;
    case 'ref':
      return expr.path.join('.');
    case 'int':
      return String(expr.value);
  }
}
