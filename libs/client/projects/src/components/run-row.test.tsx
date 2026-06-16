import type {RunDto} from '@shipfox/api-workflows-dto';
import {render, screen} from '@testing-library/react';
import type {ReactNode} from 'react';
import {RelativeTimeProvider} from '#lib/relative-time.js';
import {RunRow} from './run-row.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEPLOY_PRODUCTION_RE = /Deploy production/;

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children: ReactNode;
    params: Record<string, string>;
    to: string;
  }) => {
    const href = Object.entries(params).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to,
    );
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

function makeRun(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: 'abcd1234-0000-4000-8000-000000000000',
    project_id: PROJECT_ID,
    definition_id: '33333333-3333-4333-8333-333333333333',
    name: 'Deploy production',
    status: 'succeeded',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {source: 'manual', event: 'fire'},
    inputs: null,
    duration_ms: 0,
    created_at: '2026-05-13T00:00:00.000Z',
    updated_at: '2026-05-13T00:00:13.000Z',
    ...overrides,
  };
}

function renderRow(run: RunDto) {
  return render(
    <RelativeTimeProvider>
      <RunRow projectId={PROJECT_ID} run={run} workspaceId={WORKSPACE_ID} />
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
        duration_ms: 0,
        created_at: '2026-05-13T00:00:00.000Z',
        updated_at: '2026-05-13T00:00:10.000Z',
      }),
    );

    expect(screen.getByText('running 30s')).toBeInTheDocument();

    vi.useRealTimers();
  });

  test('links to the run detail route', () => {
    renderRow(makeRun());

    expect(screen.getByRole('link', {name: DEPLOY_PRODUCTION_RE})).toHaveAttribute(
      'href',
      `/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/runs/abcd1234-0000-4000-8000-000000000000`,
    );
  });
});
