import type {Meta, StoryObj} from '@storybook/react';
import {Code, Header} from '#components/typography/index.js';
import {
  Callout,
  CalloutAction,
  CalloutActions,
  CalloutContent,
  CalloutDescription,
  CalloutTitle,
  calloutTypes,
} from './callout.js';

const variants = ['primary', 'secondary'] as const;

const typeLabels = {
  default: 'Default',
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
} satisfies Record<(typeof calloutTypes)[number], string>;

const meta = {
  title: 'Components/Callout',
  component: Callout,
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: calloutTypes,
    },
    variant: {
      control: 'select',
      options: variants,
    },
    icon: {
      control: 'select',
      options: [undefined, null, 'bookOpen'],
    },
  },
  args: {
    type: 'default',
    variant: 'primary',
  },
} satisfies Meta<typeof Callout>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Callout {...args}>
      <CalloutContent>
        <CalloutTitle>{typeLabels[args.type]} level</CalloutTitle>
        <CalloutDescription>
          {typeLabels[args.type]} callout using the {args.variant} variant.
        </CalloutDescription>
      </CalloutContent>
      <CalloutActions>
        <CalloutAction variant={args.variant}>Label</CalloutAction>
        <CalloutAction variant={args.variant}>Label</CalloutAction>
      </CalloutActions>
    </Callout>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      {variants.map((variant) => (
        <div key={variant} className="flex flex-col gap-12">
          <Code variant="label" className="text-foreground-neutral-subtle">
            {variant}
          </Code>
          {calloutTypes.map((type) => (
            <div key={type} className="grid gap-8">
              <Callout type={type} variant={variant}>
                <CalloutContent>
                  <CalloutTitle>{typeLabels[type]} single-line callout</CalloutTitle>
                </CalloutContent>
              </Callout>
              <Callout type={type} variant={variant} icon={null}>
                <CalloutContent>
                  <CalloutTitle>{typeLabels[type]} side-line callout</CalloutTitle>
                  <CalloutDescription>
                    Additional explanatory copy shows how the leading slot aligns when the callout
                    wraps onto multiple lines.
                  </CalloutDescription>
                </CalloutContent>
                <CalloutActions>
                  <CalloutAction variant="primary">Confirm</CalloutAction>
                  <CalloutAction variant="secondary">Dismiss</CalloutAction>
                </CalloutActions>
              </Callout>
              <Callout type={type} variant={variant} icon="bookOpen">
                <CalloutContent>
                  <CalloutTitle>{typeLabels[type]} custom icon</CalloutTitle>
                </CalloutContent>
              </Callout>
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};

export const Compositions: Story = {
  render: () => (
    <div className="flex flex-col gap-32 pb-64 pt-32 px-32 bg-background-neutral-base">
      <Header variant="h3" className="text-foreground-neutral-subtle">
        CALLOUTS
      </Header>
      <div className="flex flex-col gap-16">
        <Code variant="label" className="text-foreground-neutral-subtle">
          Primary
        </Code>
        {calloutTypes.map((type) => (
          <Callout key={type} type={type} variant="primary">
            <CalloutContent>
              <CalloutTitle>{typeLabels[type]} level</CalloutTitle>
              <CalloutDescription>
                {typeLabels[type]} callout using the primary variant.
              </CalloutDescription>
            </CalloutContent>
            <CalloutActions>
              <CalloutAction variant="primary">Label</CalloutAction>
              <CalloutAction variant="secondary">Label</CalloutAction>
            </CalloutActions>
          </Callout>
        ))}
        <Code variant="label" className="text-foreground-neutral-subtle">
          Secondary
        </Code>
        {calloutTypes.map((type) => (
          <Callout key={type} type={type} variant="secondary" icon={null}>
            <CalloutContent>
              <CalloutTitle>{typeLabels[type]} level</CalloutTitle>
              <CalloutDescription>
                {typeLabels[type]} callout using the secondary side-line treatment.
              </CalloutDescription>
            </CalloutContent>
            <CalloutActions>
              <CalloutAction variant="primary">Label</CalloutAction>
              <CalloutAction variant="secondary">Label</CalloutAction>
            </CalloutActions>
          </Callout>
        ))}
      </div>
    </div>
  ),
};
