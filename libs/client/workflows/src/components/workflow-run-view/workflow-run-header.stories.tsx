import type {RunResponseDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {WorkflowRunHeader} from './workflow-run-header.js';

let seq = 0;
function makeRun(overrides: Partial<RunResponseDto> = {}): RunResponseDto {
  seq += 1;
  return {
    id: `run-${String(seq).padStart(8, '0')}`,
    project_id: 'proj-demo',
    definition_id: 'def-demo',
    name: 'deploy-web',
    status: 'succeeded',
    trigger_source: 'github',
    trigger_event: 'push',
    trigger_payload: {},
    inputs: null,
    created_at: new Date(Date.now() - 180_000).toISOString(),
    updated_at: new Date(Date.now() - 60_000).toISOString(),
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

// In the app the bar sits on the shell's subtle background, constrained to a content width.
// The decorator reproduces that so the bottom border and name truncation read the way they do
// in app; `frameWidth` lets the breakpoint stories choose their own width.
const withFrame: Decorator = (Story, ctx) => {
  const width = (ctx.parameters.frameWidth as number | undefined) ?? 1280;
  return (
    <div className="min-h-screen bg-background-subtle-base py-24">
      <div style={{width}} className="mx-auto min-w-0">
        <Story />
      </div>
    </div>
  );
};

const meta = {
  title: 'Workflows/RunView/Header',
  component: WorkflowRunHeader,
  parameters: {layout: 'fullscreen'},
  decorators: [withFrame],
  args: {run: makeRun()},
} satisfies Meta<typeof WorkflowRunHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const ALL_STATUSES: RunStatusDto[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];

export const Statuses: Story = {
  render: () => (
    <div className="flex flex-col gap-12">
      {ALL_STATUSES.map((status) => (
        <WorkflowRunHeader key={status} run={makeRun({status, name: `${status}-pipeline`})} />
      ))}
    </div>
  ),
};

export const LongName: Story = {
  args: {
    run: makeRun({
      name: 'release-production-multi-region-with-canary-and-smoke-tests-and-more',
      trigger_source: 'scheduler',
    }),
  },
};

// Same run across common content widths so you can see how the bar packs and where the
// name truncates, from a phone up to a wide desktop.
const RESPONSIVE_RUN = makeRun({name: 'release-production-multi-region-canary'});

export const Mobile: Story = {
  args: {run: RESPONSIVE_RUN},
  parameters: {frameWidth: 375},
};

export const Tablet: Story = {
  args: {run: RESPONSIVE_RUN},
  parameters: {frameWidth: 768},
};

export const Laptop: Story = {
  args: {run: RESPONSIVE_RUN},
  parameters: {frameWidth: 1024},
};

export const Wide: Story = {
  args: {run: RESPONSIVE_RUN},
  parameters: {frameWidth: 1536},
};
