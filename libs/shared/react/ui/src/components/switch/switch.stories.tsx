import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {Label} from '#components/label/index.js';
import {Text} from '#components/typography/index.js';
import {Switch} from './switch.js';

const meta = {
  title: 'Components/Switch',
  component: Switch,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    checked: {
      control: 'boolean',
    },
    disabled: {
      control: 'boolean',
    },
  },
  args: {
    size: 'md',
    disabled: false,
  },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => <Switch {...args} />,
};

const sizes = ['sm', 'md', 'lg'] as const;

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-24">
      {sizes.map((size) => (
        <div key={size} className="grid grid-cols-[72px_repeat(5,88px)] items-center gap-12">
          <Text size="sm" bold className="capitalize">
            {size}
          </Text>
          <StatePreview label="Off">
            <Switch size={size} />
          </StatePreview>
          <StatePreview label="On">
            <Switch size={size} defaultChecked />
          </StatePreview>
          <StatePreview label="Focus">
            <Switch size={size} className="focus" />
          </StatePreview>
          <StatePreview label="Disabled">
            <Switch size={size} disabled />
          </StatePreview>
          <StatePreview label="Disabled on">
            <Switch size={size} defaultChecked disabled />
          </StatePreview>
        </div>
      ))}
    </div>
  ),
  parameters: {
    pseudo: {
      focusVisible: '.focus',
    },
  },
};

export const Compositions: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <div className="flex items-center gap-8">
        <Switch id="notifications" />
        <Label htmlFor="notifications">Enable notifications</Label>
      </div>
      <div className="flex items-center gap-8">
        <Switch id="dark-mode" defaultChecked />
        <Label htmlFor="dark-mode">Dark mode</Label>
      </div>
      <div className="flex items-center gap-8">
        <Switch id="disabled-switch" disabled />
        <Label htmlFor="disabled-switch" className="opacity-50">
          Disabled option
        </Label>
      </div>
    </div>
  ),
};

function StatePreview({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-8">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      {children}
    </div>
  );
}
