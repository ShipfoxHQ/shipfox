import {describe, expect, test} from '@shipfox/vitest/vi';
import {type HomePanelInput, selectHomePanel} from './home-panel.js';

function input(overrides: Partial<HomePanelInput> = {}): HomePanelInput {
  return {
    dismissed: false,
    settled: true,
    integrationsLoaded: true,
    toolsStepFinished: false,
    firstWorkflow: {state: 'open'},
    canRunWorkflows: true,
    checklistVisible: true,
    ...overrides,
  };
}

describe('selectHomePanel', () => {
  test('shows the tools panel while the flag is unset and the first workflow is open', () => {
    expect(selectHomePanel(input())).toBe('tools');
  });

  test('keeps the tools panel whatever the checklist says about the tools row', () => {
    // A connected tool marks the row done; the panel only leaves on its button.
    expect(selectHomePanel(input({checklistVisible: false}))).toBe('tools');
  });

  test('shows the first-workflow panel once the flag is set', () => {
    expect(selectHomePanel(input({toolsStepFinished: true}))).toBe('first-workflow');
  });

  test('shows no tools panel once a test run succeeded', () => {
    const panel = selectHomePanel(
      input({firstWorkflow: {state: 'test_run_succeeded', testRunId: 'run-1'}}),
    );

    expect(panel).toBe('first-workflow');
  });

  test('shows no tools panel once the first workflow is done', () => {
    expect(selectHomePanel(input({firstWorkflow: {state: 'done'}}))).toBe('checklist');
    expect(selectHomePanel(input({firstWorkflow: {state: 'done'}, checklistVisible: false}))).toBe(
      'none',
    );
  });

  test('shows nothing while a read is unsettled', () => {
    expect(selectHomePanel(input({settled: false}))).toBe('none');
    expect(selectHomePanel(input({settled: false, firstWorkflow: undefined}))).toBe('none');
  });

  test('falls through to the checklist when the first-workflow read failed', () => {
    expect(selectHomePanel(input({firstWorkflow: undefined}))).toBe('checklist');
  });

  test('falls through to the checklist when the providers or connections read failed', () => {
    const panel = selectHomePanel(input({integrationsLoaded: false, canRunWorkflows: false}));

    expect(panel).toBe('checklist');
  });

  test('falls through to the checklist when runs are not possible yet', () => {
    const panel = selectHomePanel(input({toolsStepFinished: true, canRunWorkflows: false}));

    expect(panel).toBe('checklist');
  });

  test('shows nothing when the setup guide is hidden', () => {
    expect(selectHomePanel(input({dismissed: true}))).toBe('none');
  });

  test('shows nothing when no rule matches', () => {
    const panel = selectHomePanel(
      input({toolsStepFinished: true, canRunWorkflows: false, checklistVisible: false}),
    );

    expect(panel).toBe('none');
  });
});
