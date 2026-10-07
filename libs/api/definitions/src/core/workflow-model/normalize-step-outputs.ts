import {
  hasOutputDefault,
  type OutputDeclarations,
  type OutputTypeDeclaration,
  validateJsonSchema,
  validateOutputDefault,
} from '@shipfox/expression';
import type {WorkflowDocumentStep} from '@shipfox/workflow-document';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

export function normalizeStepOutputs(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
}): OutputDeclarations | undefined {
  if (params.step.tool !== undefined) return undefined;
  const outputs = params.step.outputs;
  if (outputs === undefined) return undefined;

  for (const [key, declaration] of Object.entries(outputs)) {
    const path = ['jobs', params.sourceName, 'steps', params.stepIndex, 'outputs', key];
    const schemaIsValid = checkOutputSchema({declaration, key, path, issues: params.issues});
    if (!hasOutputDefault(declaration)) continue;

    if (params.step.checkout !== undefined) {
      params.issues.push(
        issue({
          code: 'invalid-output-default',
          message: `Step output "${key}" cannot declare a default on a checkout step.`,
          path: [...path, 'default'],
          details: {output: key},
        }),
      );
      continue;
    }

    // An invalid schema is already reported, and the default cannot be checked against it.
    if (schemaIsValid) checkOutputDefault({declaration, key, path, issues: params.issues});
  }

  return outputs;
}

function checkOutputSchema(params: {
  declaration: OutputTypeDeclaration;
  key: string;
  path: (string | number)[];
  issues: WorkflowModelValidationIssue[];
}): boolean {
  const {declaration, key} = params;
  if (declaration.type !== 'json' || declaration.schema === undefined) return true;

  const validation = validateJsonSchema(declaration.schema);
  if (validation.ok) return true;

  params.issues.push(
    issue({
      code: 'invalid-output-schema',
      message: `Step output "${key}" must declare a valid JSON Schema.`,
      path: [...params.path, 'schema'],
      details: {
        output: key,
        reason: validation.reason,
      },
    }),
  );
  return false;
}

function checkOutputDefault(params: {
  declaration: OutputTypeDeclaration;
  key: string;
  path: (string | number)[];
  issues: WorkflowModelValidationIssue[];
}): void {
  const validation = validateOutputDefault(params.declaration);
  if (validation.ok) return;

  params.issues.push(
    issue({
      code: 'invalid-output-default',
      message: `Step output "${params.key}" has a default that does not match its declaration.`,
      path: [...params.path, 'default'],
      details: {
        output: params.key,
        reason: validation.reason,
      },
    }),
  );
}
