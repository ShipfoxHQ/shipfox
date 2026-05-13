import {render, screen} from '@testing-library/react';
import {RunStatusFilter} from './run-status-filter.js';

const NONE_SELECTED_RE = /status filter, none selected/i;
const ONE_SELECTED_RE = /status filter, 1 of 5 selected \(running\)/i;

describe('RunStatusFilter', () => {
  test('trigger reads "Status" when nothing is selected', () => {
    render(
      <RunStatusFilter
        value={undefined}
        counts={[]}
        countsUnavailable={false}
        onChange={vi.fn()}
        onRetryCounts={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', {name: NONE_SELECTED_RE});
    expect(trigger).toHaveTextContent('Status');
    expect(trigger).not.toHaveTextContent('/5');
  });

  test('trigger reads "Status 1/5" and names the selected status when one is selected', () => {
    render(
      <RunStatusFilter
        value="running"
        counts={[]}
        countsUnavailable={false}
        onChange={vi.fn()}
        onRetryCounts={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', {name: ONE_SELECTED_RE});
    expect(trigger).toHaveTextContent('Status 1/5');
  });
});
