import {render, screen} from '@testing-library/react';
import {createRef} from 'react';
import {workflowStep} from '#test/fixtures/workflow-run.js';
import type {StepExpandedContext} from '../step-list/index.js';

vi.mock('./step-attempt-log-panel.js', () => ({
  StepAttemptLogPanel: () => <div>Log viewer</div>,
}));

import {ExpandedStep} from './job-detail-view.js';

describe('ExpandedStep', () => {
  it('does not mount the log panel for a pre-dispatch configuration failure', () => {
    renderExpandedStep({
      attemptStatus: 'failed',
      attemptError: {
        reason: 'config_unresolvable',
        field: 'agent.session',
        source: 'steps.confirm_current_head.outputs.current_head_sha',
      },
    });

    expect(screen.getByRole('heading', {name: 'Step did not run'})).toBeInTheDocument();
    expect(screen.queryByText('Log viewer')).toBeNull();
  });

  it('keeps the normal log panel for an executed attempt with no output', () => {
    renderExpandedStep({attemptStatus: 'succeeded', attemptError: null});

    expect(screen.getByText('Log viewer')).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Step did not run'})).toBeNull();
  });
});

function renderExpandedStep({
  attemptStatus,
  attemptError,
}: Pick<StepExpandedContext, 'attemptStatus' | 'attemptError'>) {
  const context: StepExpandedContext = {
    step: workflowStep(),
    stepId: '55555555-5555-4555-8555-555555555555',
    stepLabel: 'Resolve agent session',
    sourceLocation: null,
    attempt: 1,
    attemptOrdinal: 1,
    attemptId: '66666666-6666-4666-8666-666666666666',
    attemptStartedAt: '2026-09-20T12:00:00.000Z',
    attemptError,
    attemptStatus,
    carriedOver: false,
  };
  render(
    <ExpandedStep
      context={context}
      pageScrollRef={createRef<HTMLDivElement>()}
      search=""
      wrap={false}
      showLineNumbers
      attemptId={context.attemptId}
      refreshToken={0}
      onFetchingChange={() => undefined}
      workspaceSlug="acme"
      projectSlug="platform"
      workflowRunId="11111111-1111-4111-8111-111111111111"
      runAttempt={1}
    />,
  );
}
