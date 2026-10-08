import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {Shippy, type ShippyPose} from './shippy.js';

const POSES: readonly ShippyPose[] = [
  'bench',
  'nameplate',
  'lost',
  'extinguisher',
  'lot',
  'button',
  'switchboard',
  'cartridge',
  'party',
];

const meta = {
  title: 'Shell/Shippy',
  component: Shippy,
  parameters: {layout: 'centered'},
  args: {pose: 'bench', className: 'h-104'},
  argTypes: {pose: {control: 'select', options: POSES}},
} satisfies Meta<typeof Shippy>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Poses: Story = {
  render: () => (
    <div className="grid grid-cols-5 items-end gap-region">
      {POSES.map((pose) => (
        <div key={pose} className="flex flex-col items-center gap-inline">
          <Shippy pose={pose} className="h-96" />
          <Text size="xs" className="text-foreground-neutral-muted">
            {pose}
          </Text>
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-region">
      <Shippy pose="lost" className="h-160" />
      <Shippy pose="bench" className="h-104" />
      <Shippy pose="lot" className="h-96" />
      <Shippy pose="party" className="h-56" />
    </div>
  ),
};
