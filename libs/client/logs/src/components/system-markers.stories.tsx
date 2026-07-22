import {LogRows} from '@shipfox/react-ui/log';
import type {Meta, StoryObj} from '@storybook/react';
import {CappedMarker, EndMarker, GapMarker, RunnerLostMarker} from './system-markers.js';

const ts = new Date('2026-06-23T10:00:00.000Z').getTime();

const meta = {
  title: 'Logs/SystemMarkers',
  component: EndMarker,
  parameters: {layout: 'padded'},
  tags: ['autodocs'],
} satisfies Meta<typeof EndMarker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <EndMarker
          record={{v: 1, ts, type: 'end', totalBytes: 15_360}}
          lineCount={412}
          durationMs={2100}
        />
      </LogRows>
    </div>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <GapMarker record={{v: 1, ts, type: 'gap', droppedBytes: 2048}} />
        <CappedMarker record={{v: 1, ts, type: 'capped'}} />
        <RunnerLostMarker record={{v: 1, ts, type: 'runner_lost'}} />
        <EndMarker
          record={{v: 1, ts, type: 'end', totalBytes: 15_360}}
          lineCount={412}
          durationMs={2100}
        />
      </LogRows>
    </div>
  ),
};
