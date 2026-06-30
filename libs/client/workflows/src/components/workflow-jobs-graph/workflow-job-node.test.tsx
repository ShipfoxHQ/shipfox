import type {RunJobDetailDto} from '@shipfox/api-workflows-dto';
import {render, screen} from '@testing-library/react';
import {workflowJob} from '#test/fixtures/workflow-run.js';
import type {WorkflowJobGraphNode} from './graph-model.js';
import {WorkflowJobNode} from './workflow-job-node.js';

const NOW = Date.parse('2026-06-26T12:00:00.000Z');

function makeNode(overrides: Partial<RunJobDetailDto> & {name: string}): WorkflowJobGraphNode {
  const job = workflowJob(overrides);
  return {
    ...job,
    column: 0,
    row: 0,
    currentDependencyCount: 0,
  };
}

function renderNode(node: WorkflowJobGraphNode) {
  return render(
    <WorkflowJobNode
      node={node}
      selected={false}
      onSelect={() => undefined}
      onKeyDown={() => undefined}
      onHoverStart={() => undefined}
      onHoverEnd={() => undefined}
    />,
  );
}

describe('WorkflowJobNode duration', () => {
  test('shows the static span for a finished job', () => {
    const node = makeNode({
      name: 'build',
      status: 'succeeded',
      started_at: '2026-06-26T11:57:46.000Z',
      finished_at: '2026-06-26T12:00:00.000Z',
    });

    renderNode(node);

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Succeeded, ran 2m 14s'})).toBeInTheDocument();
  });

  test('clamps a skewed finished span (finishedAt before startedAt) to 0s', () => {
    const node = makeNode({
      name: 'build',
      status: 'succeeded',
      started_at: '2026-06-26T12:00:00.000Z',
      finished_at: '2026-06-26T11:59:55.000Z',
    });

    renderNode(node);

    expect(screen.getByText('0s')).toBeInTheDocument();
  });

  test('shows no duration for a skipped job that never executed', () => {
    const node = makeNode({name: 'lint', status: 'skipped'});

    renderNode(node);

    // Exact accessible name proves no duration phrase was appended.
    expect(screen.getByRole('button', {name: 'lint, Skipped'})).toBeInTheDocument();
  });

  test('shows live elapsed from startedAt for a running job', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const node = makeNode({
      name: 'test',
      status: 'running',
      queued_at: '2026-06-26T11:54:00.000Z',
      started_at: '2026-06-26T11:57:46.000Z',
    });

    renderNode(node);

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'test, Running, running 2m 14s'})).toBeInTheDocument();
  });

  test('shows live elapsed from queuedAt for a job waiting in the queue', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const node = makeNode({
      name: 'deploy',
      status: 'pending',
      queued_at: '2026-06-26T11:54:00.000Z',
      started_at: null,
    });

    renderNode(node);

    expect(screen.getByText('6m 00s')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'deploy, Pending, queued 6m 00s'}),
    ).toBeInTheDocument();
  });
});
