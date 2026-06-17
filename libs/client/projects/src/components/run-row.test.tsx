import type {RunDto} from '@shipfox/api-workflows-dto';
import {render, screen} from '@testing-library/react';
import {RelativeTimeProvider} from '#lib/relative-time.js';
import {RunRow} from './run-row.js';

function makeRun(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: 'abcd1234-0000-0000-0000-000000000000',
    project_id: 'p',
    definition_id: 'd',
    name: 'Deploy production',
    status: 'succeeded',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {source: 'manual', event: 'fire'},
    inputs: null,
    source_snapshot: null,
    created_at: '2026-05-13T00:00:00.000Z',
    updated_at: '2026-05-13T00:00:13.000Z',
    ...overrides,
  };
}

function renderRow(run: RunDto) {
  return render(
    <RelativeTimeProvider>
      <RunRow run={run} />
    </RelativeTimeProvider>,
  );
}

describe('RunRow', () => {
  test('renders short id, trigger, workflow name, and terminal duration', () => {
    renderRow(makeRun({status: 'succeeded'}));

    expect(screen.getByText('abcd1234')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByText('13s')).toBeInTheDocument();
  });

  test('shows "running Xs" with current-time computation for running runs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-05-13T00:00:30.000Z'));

    renderRow(
      makeRun({
        status: 'running',
        created_at: '2026-05-13T00:00:00.000Z',
        updated_at: '2026-05-13T00:00:10.000Z',
      }),
    );

    // running runs ignore updated_at and recompute against now.
    expect(screen.getByText('running 30s')).toBeInTheDocument();

    vi.useRealTimers();
  });

  test('is presentational — the row itself carries no link/button role (RunsList owns navigation)', () => {
    const {container} = renderRow(makeRun());

    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute('role')).not.toBe('button');
    expect(row.tagName).not.toBe('A');
  });
});
