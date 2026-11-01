import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceDetail,
  TraceLine,
  type TraceStatus,
  TraceTitle,
} from './trace.js';

function ToolRow({status}: {status: TraceStatus}) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={status}>
            <TraceTitle>Read logs of</TraceTitle>
            <TraceDescription>Run tests</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <TraceDetail>connect ECONNREFUSED</TraceDetail>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

describe('Trace', () => {
  test.each([
    ['running', 'Running'],
    ['succeeded', 'Succeeded'],
    ['failed', 'Failed'],
  ] as const)('names the %s status in the row', (status, label) => {
    render(<ToolRow status={status} />);

    expect(screen.getByRole('button', {name: new RegExp(`^${label}`)})).toBeTruthy();
  });

  test('stays collapsed by default', () => {
    render(<ToolRow status="succeeded" />);

    expect(screen.queryByText('connect ECONNREFUSED')).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  test('opens by keyboard and makes the detail reachable for scrolling', async () => {
    const user = userEvent.setup();
    render(<ToolRow status="succeeded" />);

    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();

    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('group', {name: 'Tool detail'}));
  });

  test('renders a line with nothing to expand outside a collapsible', () => {
    render(
      <Trace>
        <TraceLine status="running">
          <TraceTitle>Reading run</TraceTitle>
        </TraceLine>
      </Trace>,
    );

    expect(screen.getByRole('img', {name: 'Running'})).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
