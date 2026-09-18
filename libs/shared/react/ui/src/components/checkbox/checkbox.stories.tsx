import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {Label} from '#components/label/index.js';
import {Panel} from '#components/panel/index.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/table/index.js';
import {Text} from '#components/typography/index.js';
import {Checkbox, type CheckedState} from './checkbox.js';

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: {
    disabled: false,
  },
  argTypes: {
    checked: {
      control: 'select',
      options: [false, true, 'indeterminate'],
    },
    disabled: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    'aria-label': 'Select workflow',
  },
  render: (args) => (
    <div className="flex w-640 flex-col gap-section">
      <div className="flex flex-col gap-inline">
        <Text size="sm" bold>
          Interactive checkbox
        </Text>
        <Checkbox {...args} />
      </div>
      <StateMatrix />
      <SelectionTable />
    </div>
  ),
  parameters: {
    pseudo: {
      focusVisible: '.checkbox-focus',
    },
  },
};

const states: Array<{label: string; checked: CheckedState; disabled?: boolean; focus?: boolean}> = [
  {label: 'Unchecked', checked: false},
  {label: 'Checked', checked: true},
  {label: 'Indeterminate', checked: 'indeterminate'},
  {label: 'Focus', checked: false, focus: true},
  {label: 'Checked focus', checked: true, focus: true},
  {label: 'Mixed focus', checked: 'indeterminate', focus: true},
  {label: 'Disabled', checked: false, disabled: true},
  {label: 'Disabled checked', checked: true, disabled: true},
];

export const States: Story = {
  render: () => <StateMatrix />,
  parameters: {
    pseudo: {
      focusVisible: '.checkbox-focus',
    },
  },
};

export const Compositions: Story = {
  render: () => (
    <div className="flex w-640 flex-col gap-section">
      <div className="flex items-start gap-inline">
        <Checkbox id="release-workflow" aria-describedby="release-workflow-description" />
        <div className="flex flex-col gap-tight">
          <Label htmlFor="release-workflow">Include release workflow</Label>
          <Text id="release-workflow-description" size="sm" color="muted">
            Select this workflow for the next release.
          </Text>
        </div>
      </div>

      <SelectionTable />
    </div>
  ),
};

export const CompactDensity: Story = {
  render: () => (
    <div data-density="compact" className="flex flex-col gap-inline">
      <Text size="sm" bold>
        Compact selection
      </Text>
      <div className="flex items-center gap-inline">
        <Checkbox id="compact-workflow" defaultChecked />
        <Label htmlFor="compact-workflow">Deploy production</Label>
      </div>
      <div className="flex items-center gap-inline">
        <Checkbox id="compact-nightly" />
        <Label htmlFor="compact-nightly">Nightly verification</Label>
      </div>
    </div>
  ),
};

function StatePreview({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-96 flex-col gap-inline">
      <Text size="xs" color="muted">
        {label}
      </Text>
      {children}
    </div>
  );
}

function StateMatrix() {
  return (
    <div className="grid grid-cols-4 gap-group">
      {states.map((state) => (
        <StatePreview key={state.label} label={state.label}>
          <Checkbox
            aria-label={state.label}
            checked={state.checked}
            disabled={state.disabled}
            className={state.focus ? 'checkbox-focus' : undefined}
          />
        </StatePreview>
      ))}
    </div>
  );
}

function SelectionTable() {
  return (
    <Panel>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Checkbox aria-label="Select visible workflows" checked="indeterminate" />
            </TableHead>
            <TableHead>Workflow</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-selected="true">
            <TableCell>
              <Checkbox aria-label="Select Deploy production" checked />
            </TableCell>
            <TableCell>Deploy production</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>
              <Checkbox aria-label="Select Nightly verification" />
            </TableCell>
            <TableCell>Nightly verification</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Panel>
  );
}
