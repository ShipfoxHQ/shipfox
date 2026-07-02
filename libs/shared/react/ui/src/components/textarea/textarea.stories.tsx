import type {Meta, StoryObj} from '@storybook/react';
import {Label} from '#components/label/index.js';
import {Code} from '#components/typography/index.js';
import {Textarea} from './textarea.js';

const meta = {
  title: 'Components/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['base', 'component'],
    },
    size: {
      control: 'select',
      options: ['base', 'small'],
    },
    rows: {control: 'number'},
  },
  args: {
    placeholder: 'Type a note',
    variant: 'base',
    size: 'base',
    rows: 4,
  },
} satisfies Meta<typeof Textarea>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: (args) => (
    <div className="grid w-420 gap-16">
      <div className="grid gap-8">
        <Label htmlFor="default-textarea">Default</Label>
        <Textarea {...args} id="default-textarea" />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="filled-textarea">Filled</Label>
        <Textarea
          {...args}
          id="filled-textarea"
          defaultValue="Summarize the runner failure and include the first failing command."
        />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="invalid-textarea">Invalid</Label>
        <Textarea {...args} id="invalid-textarea" aria-invalid defaultValue="Too short" />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="disabled-textarea">Disabled</Label>
        <Textarea {...args} id="disabled-textarea" disabled defaultValue="Disabled value" />
      </div>
    </div>
  ),
};

export const Variants: Story = {
  render: (args) => (
    <div className="grid w-420 gap-16">
      {(['base', 'component'] as const).map((variant) => (
        <div key={variant} className="grid gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            {variant}
          </Code>
          <Textarea
            {...args}
            variant={variant}
            defaultValue="A textarea field with shared form styling."
          />
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="grid w-420 gap-16">
      {(['base', 'small'] as const).map((size) => (
        <div key={size} className="grid gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            {size}
          </Code>
          <Textarea {...args} size={size} />
        </div>
      ))}
    </div>
  ),
};
