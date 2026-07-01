import type {Meta, StoryObj} from '@storybook/react';
import {Text} from '#components/typography/index.js';
import {Accordion, AccordionContent, AccordionItem, AccordionTrigger} from './accordion.js';

const meta = {
  title: 'Components/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Vertically stacked sections that reveal content, built on `@radix-ui/react-accordion`. Use `type="single"` for one open panel, or `type="multiple"` when independent sections can stay open together.',
      },
    },
  },
} satisfies Meta<typeof Accordion>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Accordion type="single" collapsible defaultValue="repository" className="w-[420px]">
      <AccordionItem value="repository">
        <AccordionTrigger>
          <Text size="sm" bold>
            Repository access
          </Text>
        </AccordionTrigger>
        <AccordionContent>
          Grant runners read access to the repositories they need to clone. You can update access
          from workspace settings.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="secrets">
        <AccordionTrigger>
          <Text size="sm" bold>
            Runtime secrets
          </Text>
        </AccordionTrigger>
        <AccordionContent>
          Secrets are injected only for jobs that request them. Values stay out of logs and workflow
          metadata.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = {
  render: () => (
    <Accordion
      type="multiple"
      defaultValue={['notifications', 'billing']}
      className="w-[420px] rounded-8 border border-border-neutral-base bg-background-components-base"
    >
      <AccordionItem value="notifications">
        <AccordionTrigger>
          <Text size="sm" bold>
            Notifications
          </Text>
        </AccordionTrigger>
        <AccordionContent>
          Send status changes to email, Slack, or webhooks when a workflow completes.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="billing">
        <AccordionTrigger>
          <Text size="sm" bold>
            Billing
          </Text>
        </AccordionTrigger>
        <AccordionContent>
          Build minutes are counted from runner claim to terminal job state.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="disabled" disabled>
        <AccordionTrigger>
          <Text size="sm" bold>
            Enterprise controls
          </Text>
        </AccordionTrigger>
        <AccordionContent>Disabled sections cannot be opened.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
