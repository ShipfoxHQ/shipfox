import {render, screen} from '@testing-library/react';
import {workflowStepOverviewFixtures} from './workflow-step-overview.fixtures.js';
import {WorkflowStepOverview} from './workflow-step-overview.js';

describe('WorkflowStepOverview', () => {
  test('renders an empty state when no step is selected', () => {
    render(<WorkflowStepOverview selection={null} />);

    expect(screen.getByText('Select a step')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose a step from the run to inspect its command, attempts, and current result.',
      ),
    ).toBeInTheDocument();
  });

  test('renders the running state with command and output', () => {
    render(<WorkflowStepOverview selection={workflowStepOverviewFixtures.running} />);

    expect(screen.getByText('compare_error_budget')).toBeInTheDocument();
    expect(screen.getByText('Active step')).toBeInTheDocument();
    expect(
      screen.getByText('shipfox slo compare --service checkout-api --budget checkout-payment'),
    ).toBeInTheDocument();
    expect(screen.getByText('collecting')).toBeInTheDocument();
  });

  test('renders a failed step with multi-attempt metadata and gate/restart details', () => {
    render(<WorkflowStepOverview selection={workflowStepOverviewFixtures.failed} />);

    expect(screen.getByText('run_unit_tests')).toBeInTheDocument();
    expect(screen.getByText('Root cause')).toBeInTheDocument();
    expect(screen.getByText('Failed with exit code 1. 3 attempts failed.')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getAllByText('Gate result')).toHaveLength(3);
    expect(screen.getByText('restart_exhausted')).toBeInTheDocument();
  });

  test('renders a succeeded step without a root-cause alert', () => {
    render(<WorkflowStepOverview selection={workflowStepOverviewFixtures.succeeded} />);

    expect(screen.getByText('notify_incident_channel')).toBeInTheDocument();
    expect(screen.getAllByText('Succeeded')).toHaveLength(2);
    expect(screen.queryByText('Root cause')).not.toBeInTheDocument();
    expect(screen.getByText('delivered')).toBeInTheDocument();
  });

  test('renders setup failures without a command block', () => {
    render(<WorkflowStepOverview selection={workflowStepOverviewFixtures.setupFailed} />);

    expect(screen.getByText('Set up job')).toBeInTheDocument();
    expect(screen.getByText('Setup failed (workspace prep failed).')).toBeInTheDocument();
    expect(screen.queryByText('Command')).not.toBeInTheDocument();
  });

  test('renders succeeded retries and highlights the current projection attempt', () => {
    render(<WorkflowStepOverview selection={workflowStepOverviewFixtures.retriedSuccess} />);

    expect(screen.getByText('verify_sentry_recovery')).toBeInTheDocument();
    expect(screen.getByText('Attempt #2')).toBeInTheDocument();
    expect(screen.getAllByText('Current projection')).toHaveLength(1);
    expect(
      screen.getByText('Sentry recovery is not good enough after canary deploy'),
    ).toBeInTheDocument();
    expect(screen.getByText('sample_count')).toBeInTheDocument();
  });

  test('renders pending steps with no attempts without crashing', () => {
    render(<WorkflowStepOverview selection={workflowStepOverviewFixtures.pending} />);

    expect(screen.getByText('Unnamed step 4')).toBeInTheDocument();
    expect(screen.queryByText('Attempt')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
  });
});
