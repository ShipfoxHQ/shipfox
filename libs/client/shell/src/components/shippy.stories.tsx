import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {Shippy, type ShippyPose} from './shippy.js';
import {ShippySprite, type ShippySpriteState} from './shippy-sprite.js';

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
  argTypes: {pose: {control: 'select', options: [...POSES, 'body', 'face']}},
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

export const LauncherSprites: Story = {
  render: () => (
    <div className="flex items-end gap-region">
      <ShippySprite state="idle" />
      <Shippy pose="body" className="h-64" />
      <Shippy pose="face" className="h-32" />
    </div>
  ),
};

const SPRITE_STATES: readonly ShippySpriteState[] = [
  'idle',
  'working',
  'reply_ready',
  'failed',
  'greeting',
];

/** Floating Shippy in each state. Visual tests stop motion, so each shows its resting frame. */
export const LauncherStates: Story = {
  render: () => (
    <div className="flex items-end gap-region">
      {SPRITE_STATES.map((state) => (
        <div key={state} className="flex flex-col items-center gap-inline">
          <ShippySprite state={state} />
          <Text size="xs" className="text-foreground-neutral-muted">
            {state}
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
