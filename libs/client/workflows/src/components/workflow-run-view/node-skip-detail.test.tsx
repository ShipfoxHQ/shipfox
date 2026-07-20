import {cleanup, render, screen} from '@testing-library/react';
import type {NodeConditionSummary} from '#core/workflow-run.js';
import {NodeSkipDetail} from './node-skip-detail.js';

afterEach(cleanup);

describe('NodeSkipDetail', () => {
  it('renders an ordinary step skip with its evaluated condition', () => {
    const condition: NodeConditionSummary = {
      expression: "steps.test.status == 'failed'",
      value: 'false',
      isDefaultGate: false,
      errored: false,
    };

    render(<NodeSkipDetail level="step" statusReason="condition_rejected" condition={condition} />);

    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(
      screen.getByText('The step condition did not match, so this step was skipped.'),
    ).toBeInTheDocument();
    expect(screen.getByText("steps.test.status == 'failed'")).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
  });

  it('labels the implicit default gate', () => {
    const condition: NodeConditionSummary = {
      expression: '!execution.failed',
      value: 'false',
      isDefaultGate: true,
      errored: false,
    };

    render(
      <NodeSkipDetail level="step" statusReason="default_gate_rejected" condition={condition} />,
    );

    expect(screen.getByText('Default gate')).toBeInTheDocument();
  });

  it('renders a broken condition distinctly for condition_errored', () => {
    const condition: NodeConditionSummary = {
      expression: 'jobs.build.outputs.redy',
      value: null,
      isDefaultGate: false,
      errored: true,
    };

    render(<NodeSkipDetail level="job" statusReason="condition_errored" condition={condition} />);

    expect(screen.getByText('Condition error')).toBeInTheDocument();
    expect(
      screen.getByText('The job condition could not be evaluated, so this job was skipped.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Skipped')).not.toBeInTheDocument();
  });
});
