import type {Meta, StoryObj} from '@storybook/react';
import {Kbd, KbdGroup} from './kbd';

const meta = {
  title: 'Components/Kbd',
  component: Kbd,
  tags: ['autodocs'],
} satisfies Meta<typeof Kbd>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex flex-wrap gap-8">
      <Kbd>Ctrl</Kbd>
      <Kbd>Alt</Kbd>
      <Kbd>Shift</Kbd>
      <Kbd>⌘</Kbd>
      <Kbd>⌥</Kbd>
      <Kbd>⇧</Kbd>
    </div>
  ),
};

export const KeyCombination: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-12">
      <Kbd>⌘K</Kbd>
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>Shift</Kbd>
        <Kbd>P</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>Alt</Kbd>
        <Kbd>Enter</Kbd>
      </KbdGroup>
    </div>
  ),
};

export const InMenu: Story = {
  render: () => (
    <div className="max-w-400 rounded-10 border border-border-neutral-base p-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between p-8 rounded-6 hover:bg-background-components-hover transition-colors">
          <span className="text-sm text-foreground-neutral-subtle">Copy</span>
          <Kbd>⌘C</Kbd>
        </div>
        <div className="flex items-center justify-between p-8 rounded-6 hover:bg-background-components-hover transition-colors">
          <span className="text-sm text-foreground-neutral-subtle">Paste</span>
          <Kbd>⌘V</Kbd>
        </div>
        <div className="h-px bg-border-neutral-base my-4" />
        <div className="flex items-center justify-between p-8 rounded-6 hover:bg-background-components-hover transition-colors">
          <span className="text-sm text-foreground-neutral-subtle">Command Palette</span>
          <Kbd>⌘K</Kbd>
        </div>
      </div>
    </div>
  ),
};
