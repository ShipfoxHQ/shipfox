import {workflowDocumentSchema} from '@shipfox/workflow-document';
import {parse} from 'yaml';
import {buildAgentWorkflowExample} from './agent-workflow-example.js';

describe('buildAgentWorkflowExample', () => {
  it.each([
    {model: 'claude-opus-4-8', expected: '        model: claude-opus-4-8'},
    {model: 'anthropic/claude-opus-4.8', expected: '        model: anthropic/claude-opus-4.8'},
    {
      model: '@cf/moonshotai/kimi-k2.7-code',
      expected: "        model: '@cf/moonshotai/kimi-k2.7-code'",
    },
    {model: "model: beta's", expected: "        model: 'model: beta''s'"},
  ])('builds valid workflow YAML for model $model', ({model, expected}) => {
    const example = buildAgentWorkflowExample({providerId: 'anthropic', model});

    const lines = example.code.split('\n');
    const parsed = parse(example.code);
    const result = workflowDocumentSchema.safeParse(parsed);

    expect(result.success).toBe(true);
    expect(lines).toContain('        provider: anthropic');
    expect(lines).toContain(expected);
    expect(example.highlightedLineRange).toEqual({startLine: 11, endLine: 12});
    expect(lines.slice(10, 12)).toEqual(['        provider: anthropic', expected]);
  });
});
