import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ComponentProps} from 'react';
import {useState} from 'react';
import {Icon} from '#components/icon/index.js';
import {Label} from '#components/label/index.js';
import {DatePicker} from './date-picker.js';

// Pin a fixed date so the filled-state snapshots stay deterministic across days.
const fixedDate = new Date(2025, 5, 15);

const OPEN_CALENDAR_REGEX = /open calendar/i;

const meta = {
  title: 'Components/DatePicker',
  component: DatePicker,
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
    state: {
      control: 'select',
      options: ['default', 'error', 'disabled'],
    },
  },
  args: {
    variant: 'base',
    size: 'base',
    state: 'default',
  },
} satisfies Meta<typeof DatePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

function ControlledPicker({
  initialDate,
  ...props
}: {initialDate?: Date} & Omit<
  ComponentProps<typeof DatePicker>,
  'date' | 'onDateSelect' | 'onClear'
>) {
  const [date, setDate] = useState<Date | undefined>(initialDate);
  return (
    <DatePicker {...props} date={date} onDateSelect={setDate} onClear={() => setDate(undefined)} />
  );
}

export const Playground: Story = {
  render: (args) => <ControlledPicker {...args} />,
};

export const WithSelectedDate: Story = {
  render: (args) => <ControlledPicker {...args} initialDate={fixedDate} />,
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-12">
      <ControlledPicker {...args} size="base" initialDate={fixedDate} />
      <ControlledPicker {...args} size="small" initialDate={fixedDate} />
    </div>
  ),
};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-12">
      <ControlledPicker {...args} variant="base" initialDate={fixedDate} />
      <ControlledPicker {...args} variant="component" initialDate={fixedDate} />
    </div>
  ),
};

export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-16">
      <div className="grid gap-8">
        <Label htmlFor="default-date">Default</Label>
        <ControlledPicker {...args} id="default-date" />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="error-date">Error</Label>
        <ControlledPicker {...args} id="error-date" state="error" initialDate={fixedDate} />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="disabled-date">Disabled</Label>
        <ControlledPicker {...args} id="disabled-date" state="disabled" initialDate={fixedDate} />
      </div>
    </div>
  ),
};

export const DateFormats: Story = {
  render: (args) => (
    <div className="flex flex-col gap-12">
      <ControlledPicker {...args} dateFormat="dd/MM/yyyy" initialDate={fixedDate} />
      <ControlledPicker {...args} dateFormat="MM/dd/yyyy" initialDate={fixedDate} />
      <ControlledPicker {...args} dateFormat="yyyy-MM-dd" initialDate={fixedDate} />
      <ControlledPicker {...args} dateFormat="MMMM d, yyyy" initialDate={fixedDate} />
    </div>
  ),
};

export const WithThreshold: Story = {
  render: (args) => (
    <ControlledPicker {...args} maxDisabledOffsetDays={30} initialDate={fixedDate} />
  ),
};

export const WithRightIcon: Story = {
  render: (args) => (
    <ControlledPicker
      {...args}
      rightIcon={<Icon name="arrowDownSLine" className="size-16 text-foreground-neutral-muted" />}
    />
  ),
};

export const Open: Story = {
  play: async (ctx) => {
    const {canvasElement, step} = ctx;
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await step('Open the calendar', async () => {
      await user.click(canvas.getByRole('button', {name: OPEN_CALENDAR_REGEX}));
    });

    await step('Wait for the calendar to render', async () => {
      await screen.findByRole('dialog');
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await argosScreenshot(ctx, 'DatePicker Open');
  },
  render: (args) => <ControlledPicker {...args} initialDate={fixedDate} />,
};
