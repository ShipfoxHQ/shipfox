import type {RequiredAction} from '@shipfox/policy-notice';
import {render, screen} from '@testing-library/react';
import {toWorkflowJobExecutionModel} from '#test/fixtures/workflow-model-mapper.js';
import {workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {DurationLimitNotice} from './duration-limit-notice.js';

function cappedExecution(requiredAction?: RequiredAction) {
  const execution = toWorkflowJobExecutionModel(workflowJobExecutionDto({status: 'running'}));
  execution.durationCapped = true;
  execution.durationNotice = {
    reason: 'job-duration-limit',
    message: 'The timeout of this job is capped.',
    ...(requiredAction ? {requiredAction} : {}),
  };
  return execution;
}

describe('DurationLimitNotice', () => {
  test('opens a relative billing link in the same tab', () => {
    render(
      <DurationLimitNotice
        execution={cappedExecution({
          reason: 'add-credits',
          message: 'Add credits',
          url: '/settings/billing',
        })}
      />,
    );

    const link = screen.getByRole('link', {name: 'Add credits'});
    expect(link).toHaveAttribute('href', '/settings/billing');
    expect(link).not.toHaveAttribute('target');
  });

  test('links a mailto support action', () => {
    render(
      <DurationLimitNotice
        execution={cappedExecution({
          reason: 'job-duration-limit',
          message: 'Contact us',
          url: 'mailto:support@shipfox.io',
          intent: 'contact-support',
        })}
      />,
    );

    expect(screen.getByRole('link', {name: 'Contact us'})).toHaveAttribute(
      'href',
      'mailto:support@shipfox.io',
    );
  });

  test('shows only the message without an action', () => {
    render(<DurationLimitNotice execution={cappedExecution()} />);

    expect(screen.getByText('The timeout of this job is capped.')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('renders nothing when the duration is not capped', () => {
    const execution = cappedExecution();
    execution.durationCapped = false;

    const {container} = render(<DurationLimitNotice execution={execution} />);

    expect(container).toBeEmptyDOMElement();
  });
});
