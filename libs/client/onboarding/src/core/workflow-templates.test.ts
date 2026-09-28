import {describe, expect, test} from '@shipfox/vitest/vi';
import {
  allToolsWorkflowTemplates,
  githubOnlyWorkflowTemplates,
} from '#test/fixtures/workflow-templates.js';
import {suggestWorkflowTemplates, workflowTemplateLabel} from './workflow-templates.js';

describe('suggestWorkflowTemplates', () => {
  test('recommends the first usable template and lists the next ones', () => {
    const {recommended, others} = suggestWorkflowTemplates(githubOnlyWorkflowTemplates);

    expect(recommended?.id).toBe('ticket-to-pr');
    expect(others.map(({id}) => id)).toEqual(['fix-default-branch-ci', 'fix-dependency-ci']);
  });

  test('caps the other suggestions at three', () => {
    const {recommended, others} = suggestWorkflowTemplates(allToolsWorkflowTemplates);

    expect(recommended?.id).toBe('ticket-to-pr');
    expect(others.map(({id}) => id)).toEqual([
      'ask-codebase',
      'slack-to-ticket',
      'fix-default-branch-ci',
    ]);
  });

  test('recommends nothing when no template is usable', () => {
    const needsConnection = githubOnlyWorkflowTemplates.filter(
      ({group}) => group === 'needs_connection',
    );

    expect(suggestWorkflowTemplates(needsConnection)).toEqual({recommended: undefined, others: []});
  });
});

describe('workflowTemplateLabel', () => {
  test('labels a manual template "Try it now" and an event template by how it starts', () => {
    const [ticketToPr, fixDefaultBranchCi] = githubOnlyWorkflowTemplates;
    if (!(ticketToPr && fixDefaultBranchCi)) throw new Error('fixture missing');

    expect(workflowTemplateLabel(ticketToPr)).toBe('Try it now');
    expect(workflowTemplateLabel(fixDefaultBranchCi)).toBe(
      'Starts when CI fails on the default branch',
    );
  });
});
