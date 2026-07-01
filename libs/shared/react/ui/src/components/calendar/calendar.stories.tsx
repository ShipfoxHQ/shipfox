import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import type {DateRange} from 'react-day-picker';
import {Calendar} from './calendar.js';

// Pin to a fixed past month so the floating "today" marker stays out of view and
// snapshots stay deterministic across days.
const referenceMonth = new Date(2024, 0, 1);

const meta = {
  title: 'Components/Calendar',
  component: Calendar,
  tags: ['autodocs'],
} satisfies Meta<typeof Calendar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => {
    const [selected, setSelected] = useState<Date | undefined>(new Date(2024, 0, 12));
    return (
      <Calendar
        mode="single"
        defaultMonth={referenceMonth}
        selected={selected}
        onSelect={setSelected}
      />
    );
  },
};

export const Range: Story = {
  render: () => {
    const [range, setRange] = useState<DateRange | undefined>({
      from: new Date(2024, 0, 8),
      to: new Date(2024, 0, 15),
    });
    return (
      <Calendar mode="range" defaultMonth={referenceMonth} selected={range} onSelect={setRange} />
    );
  },
};

export const TwoMonths: Story = {
  render: () => {
    const [range, setRange] = useState<DateRange | undefined>({
      from: new Date(2024, 0, 22),
      to: new Date(2024, 1, 5),
    });
    return (
      <Calendar
        mode="range"
        defaultMonth={referenceMonth}
        numberOfMonths={2}
        selected={range}
        onSelect={setRange}
      />
    );
  },
};

export const WithDisabledDays: Story = {
  render: () => {
    const [selected, setSelected] = useState<Date | undefined>(new Date(2024, 0, 12));
    return (
      <Calendar
        mode="single"
        defaultMonth={referenceMonth}
        selected={selected}
        onSelect={setSelected}
        disabled={{before: new Date(2024, 0, 10)}}
      />
    );
  },
};
