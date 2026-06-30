import {workflowDocumentSchema} from '@shipfox/workflow-document';
import {parse} from 'yaml';
import {buildAgentWorkflowExample} from './agent-workflow-example.js';

describe('buildAgentWorkflowExample', () => {
  it.each([
    {
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      expectedProvider: '        provider: anthropic',
      expectedModel: '        model: claude-opus-4-8',
    },
    {
      providerId: 'anthropic',
      model: 'anthropic/claude-opus-4.8',
      expectedProvider: '        provider: anthropic',
      expectedModel: '        model: anthropic/claude-opus-4.8',
    },
    {
      providerId: 'anthropic',
      model: '@cf/moonshotai/kimi-k2.7-code',
      expectedProvider: '        provider: anthropic',
      expectedModel: "        model: '@cf/moonshotai/kimi-k2.7-code'",
    },
    {
      providerId: 'provider#beta',
      model: "model: beta's",
      expectedProvider: "        provider: 'provider#beta'",
      expectedModel: "        model: 'model: beta''s'",
    },
  ])('builds valid workflow YAML for provider $providerId and model $model', ({
    providerId,
    model,
    expectedProvider,
    expectedModel,
  }) => {
    const example = buildAgentWorkflowExample({providerId, model});

    const lines = example.code.split('\n');
    const parsed = parse(example.code);
    const result = workflowDocumentSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    expect(lines).toContain(expectedProvider);
    expect(lines).toContain(expectedModel);
    expect(example.highlightedLineRange).toEqual({startLine: 11, endLine: 12});
    expect(lines.slice(10, 12)).toEqual([expectedProvider, expectedModel]);
  });
});
