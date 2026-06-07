import {createDefaultRunExitCodeAcceptancePolicy} from './expression-ir.js';
import {
  defaultAcceptanceExpressionReference,
  expressionSupportReference,
  renderExprIR,
} from './expression-language-reference.js';

describe('expression language reference', () => {
  test('documents the actual default run exit-code expression tree', () => {
    const policy = createDefaultRunExitCodeAcceptancePolicy();

    expect(defaultAcceptanceExpressionReference.policyKind).toBe(policy.kind);
    expect(defaultAcceptanceExpressionReference.expression).toBe(renderExprIR(policy.successIf));
    expect(defaultAcceptanceExpressionReference.expressionTree).toEqual(policy.successIf);
  });

  test('keeps the PR1 support matrix explicit about included and deferred concepts', () => {
    expect(expressionSupportReference.map((item) => item.concept)).toEqual([
      'Default run-step success policy',
      'Custom expression parser',
      'Expression typechecking',
      'Runtime expression evaluator',
      'Structured runner command facts',
    ]);
    expect(expressionSupportReference.filter((item) => item.status === 'included')).toHaveLength(1);
    expect(expressionSupportReference.filter((item) => item.status === 'deferred')).toHaveLength(4);
  });

  test('documents ownership and next required work for every support row', () => {
    for (const item of expressionSupportReference) {
      expect(item.owner.length).toBeGreaterThan(0);
      expect(item.pr1Behavior.length).toBeGreaterThan(0);
      expect(item.nextRequiredWork.length).toBeGreaterThan(0);
    }
  });
});
