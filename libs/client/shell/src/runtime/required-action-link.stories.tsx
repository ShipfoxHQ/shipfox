import type {RequiredAction} from '@shipfox/policy-notice';
import type {Meta, StoryObj} from '@storybook/react';
import {expect, userEvent, within} from 'storybook/test';
import {
  ChromeProvider,
  type ChromeSlots,
  type RequiredActionIntentProps,
} from './chrome-context.js';
import {
  RequiredActionDefaultLink,
  RequiredActionLink,
  RequiredActionTrigger,
} from './required-action-link.js';

const CONTACT_SUPPORT: RequiredAction = {
  reason: 'job-duration-limit',
  message: 'Contact us',
  url: 'mailto:support@shipfox.io',
  intent: 'contact-support',
};

function DemoIntentSlot({action, appearance, fallback}: RequiredActionIntentProps) {
  if (action.intent !== 'contact-support') return fallback;
  return (
    <span className="flex items-center gap-inline">
      <RequiredActionTrigger appearance={appearance} type="button">
        {action.message} in chat
      </RequiredActionTrigger>
      <RequiredActionDefaultLink action={action} appearance={appearance} />
    </span>
  );
}

function chromeWith(slot?: ChromeSlots['RequiredActionIntent']): ChromeSlots {
  return {
    ProjectBreadcrumb: () => null,
    projectSlugResolver: async () => 'project',
    ...(slot ? {RequiredActionIntent: slot} : {}),
  };
}

const meta = {
  title: 'Shell/RequiredActionLink',
  component: RequiredActionLink,
  parameters: {layout: 'centered'},
  args: {
    action: {reason: 'add-credits', message: 'Add credits', url: '/settings/billing'},
    appearance: 'button',
  },
  decorators: [
    (Story) => (
      <ChromeProvider chrome={chromeWith()}>
        <Story />
      </ChromeProvider>
    ),
  ],
} satisfies Meta<typeof RequiredActionLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Button: Story = {
  play: async ({canvasElement}) => {
    const link = await within(canvasElement).findByRole('link', {name: 'Add credits'});
    expect(link).toHaveAttribute('href', '/settings/billing');
  },
};

export const Link: Story = {
  args: {appearance: 'link'},
};

export const OtherOrigin: Story = {
  args: {
    action: {reason: 'docs', message: 'Read the docs', url: 'https://docs.shipfox.io/limits'},
  },
  play: async ({canvasElement}) => {
    const link = await within(canvasElement).findByRole('link', {name: 'Read the docs'});
    expect(link).toHaveAttribute('target', '_blank');
  },
};

export const IntentWithoutSlot: Story = {
  args: {action: CONTACT_SUPPORT},
  play: async ({canvasElement}) => {
    const link = await within(canvasElement).findByRole('link', {name: 'Contact us'});
    expect(link).toHaveAttribute('href', 'mailto:support@shipfox.io');
  },
};

export const IntentWithSlotButton: Story = {
  args: {action: CONTACT_SUPPORT},
  decorators: [
    (Story) => (
      <ChromeProvider chrome={chromeWith(DemoIntentSlot)}>
        <Story />
      </ChromeProvider>
    ),
  ],
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.hover(await canvas.findByRole('button', {name: 'Contact us in chat'}));
    expect(canvas.getByRole('link', {name: 'Contact us'})).toBeVisible();
  },
};

export const IntentWithSlotLink: Story = {
  ...IntentWithSlotButton,
  args: {action: CONTACT_SUPPORT, appearance: 'link'},
};

export const UnknownIntentWithSlot: Story = {
  args: {action: {...CONTACT_SUPPORT, intent: 'retired-intent'}},
  decorators: IntentWithSlotButton.decorators ?? [],
  play: async ({canvasElement}) => {
    const link = await within(canvasElement).findByRole('link', {name: 'Contact us'});
    expect(link).toHaveAttribute('href', 'mailto:support@shipfox.io');
  },
};
