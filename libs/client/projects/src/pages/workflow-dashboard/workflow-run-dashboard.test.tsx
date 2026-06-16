import {fireEvent, render, screen} from '@testing-library/react';
import {WorkflowRunDashboard} from './workflow-run-dashboard.js';

const run4289Pattern = /#4289/i;

describe('WorkflowRunDashboard', () => {
  test('renders the workflow run dashboard with the default step list view', () => {
    render(<WorkflowRunDashboard />);

    expect(screen.getByRole('heading', {name: 'Run #4288'})).toBeInTheDocument();
    expect(screen.getByText('Jobs graph')).toBeInTheDocument();
    expect(screen.getAllByText('remediate_checkout')[0]).toBeInTheDocument();
    expect(screen.getAllByText('verify_sentry_recovery')[0]).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Workflow source'})).toBeInTheDocument();
    expect(screen.getAllByText('SENTRY-CHKOUT-9002')[0]).toBeInTheDocument();
    expect(screen.getByText('run_unit_tests')).toBeInTheDocument();
  });

  test('switches run scenarios through the history rail', () => {
    render(<WorkflowRunDashboard />);

    fireEvent.click(screen.getByRole('button', {name: run4289Pattern}));

    expect(screen.getByRole('heading', {name: 'Run #4289'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Go to active step'})).toBeInTheDocument();
    expect(screen.getAllByText('deploy_canary')[0]).toBeInTheDocument();
  });
});
