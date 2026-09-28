import {describe, expect, test} from '@shipfox/vitest/vi';
import {
  allToolsWorkflowTemplates,
  githubOnlyWorkflowTemplates,
} from '#test/fixtures/workflow-templates.js';
import {
  joinProviderNames,
  suggestWorkflowTemplates,
  workflowTemplateCardLabel,
} from './workflow-templates.js';

describe('suggestWorkflowTemplates', () => {
  test('splits usable templates from those that need a connection, keeping rank order', () => {
    const {cards, needsConnection} = suggestWorkflowTemplates(githubOnlyWorkflowTemplates);

    expect(cards.map(({id}) => id)).toEqual([
      'ticket-to-pr',
      'fix-default-branch-ci',
      'fix-dependency-ci',
    ]);
    expect(needsConnection.map(({id}) => id)).toEqual([
      'ask-codebase',
      'slack-to-ticket',
      'report-failed-runs',
    ]);
  });

  test('caps the cards at four', () => {
    const {cards, needsConnection} = suggestWorkflowTemplates(allToolsWorkflowTemplates);

    expect(cards.map(({id}) => id)).toEqual([
      'ticket-to-pr',
      'ask-codebase',
      'slack-to-ticket',
      'fix-default-branch-ci',
    ]);
    expect(needsConnection).toEqual([]);
  });
});

describe('workflowTemplateCardLabel', () => {
  test('labels a manual template "Try it now" and an event template by how it starts', () => {
    const [ticketToPr, fixDefaultBranchCi] = githubOnlyWorkflowTemplates;
    if (!(ticketToPr && fixDefaultBranchCi)) throw new Error('fixture missing');

    expect(workflowTemplateCardLabel(ticketToPr)).toBe('Try it now');
    expect(workflowTemplateCardLabel(fixDefaultBranchCi)).toBe(
      'Starts when CI fails on the default branch',
    );
  });
});

describe('joinProviderNames', () => {
  test.each([
    [['Slack'], 'Slack'],
    [['Slack', 'Linear'], 'Slack and Linear'],
    [['Slack', 'Linear', 'Jira'], 'Slack, Linear, and Jira'],
  ])('joins %j as %s', (names, expected) => {
    expect(joinProviderNames(names)).toBe(expected);
  });
});
