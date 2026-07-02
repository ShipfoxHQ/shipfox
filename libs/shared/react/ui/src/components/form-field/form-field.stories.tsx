import type {Meta, StoryObj} from '@storybook/react';
import {Input} from '#components/input/index.js';
import {FormField, FormFieldTextarea, useFormField} from './form-field.js';

const meta = {
  title: 'Components/FormField',
  component: FormField,
  tags: ['autodocs'],
  args: {
    label: 'Email',
  },
} satisfies Meta<typeof FormField>;

export default meta;

type Story = StoryObj<typeof meta>;

function WiredInput(props: {placeholder?: string; defaultValue?: string; type?: string}) {
  return <Input {...useFormField()} {...props} />;
}

export const Playground: Story = {
  render: (args) => (
    <div className="w-360">
      <FormField {...args}>
        <WiredInput placeholder="you@example.com" type="email" />
      </FormField>
    </div>
  ),
};

export const WithDescription: Story = {
  args: {
    description: "We'll only use this to sign you in.",
  },
  render: (args) => (
    <div className="w-360">
      <FormField {...args}>
        <WiredInput placeholder="you@example.com" type="email" />
      </FormField>
    </div>
  ),
};

export const WithError: Story = {
  args: {
    error: 'Enter a valid email address.',
  },
  render: (args) => (
    <div className="w-360">
      <FormField {...args}>
        <WiredInput defaultValue="not an email" type="email" />
      </FormField>
    </div>
  ),
};

export const ErrorPreemptsDescription: Story = {
  args: {
    description: "We'll only use this to sign you in.",
    error: 'Enter a valid email address.',
  },
  render: (args) => (
    <div className="w-360">
      <FormField {...args}>
        <WiredInput defaultValue="not an email" type="email" />
      </FormField>
    </div>
  ),
};

export const WithTextarea: Story = {
  args: {
    label: 'Notes',
    description: 'Visible to workspace admins.',
  },
  render: (args) => (
    <div className="w-420">
      <FormField {...args}>
        <FormFieldTextarea placeholder="Add deployment context" rows={4} />
      </FormField>
    </div>
  ),
};
