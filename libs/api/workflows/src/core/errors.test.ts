import {
  AgentConfigUnresolvableError,
  DefinitionNotFoundError,
  isPermanentRunWorkflowError,
  ProjectMismatchError,
} from './errors.js';

describe('isPermanentRunWorkflowError', () => {
  test('is true for a deleted definition', () => {
    const result = isPermanentRunWorkflowError(new DefinitionNotFoundError('def-1'));

    expect(result).toBe(true);
  });

  test('is true for a project mismatch', () => {
    const result = isPermanentRunWorkflowError(new ProjectMismatchError('proj-a', 'proj-b'));

    expect(result).toBe(true);
  });

  test('is true for unresolvable agent configuration', () => {
    const result = isPermanentRunWorkflowError(new AgentConfigUnresolvableError('def-1'));

    expect(result).toBe(true);
  });

  test('is false for a plain error treated as transient', () => {
    const result = isPermanentRunWorkflowError(new Error('database unavailable'));

    expect(result).toBe(false);
  });

  test('is false for a non-error thrown value', () => {
    const result = isPermanentRunWorkflowError('boom');

    expect(result).toBe(false);
  });
});
