import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {Label} from '#components/label/index.js';
import {Text} from '#components/typography/index.js';
import {RadioGroup, RadioGroupItem} from './radio-group.js';

const meta = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Single-select picker built on `@radix-ui/react-radio-group`. Use for source-control connection pickers, repository pickers, and other "1-of-N" choices where each option is a card-shaped surface. Arrow keys cycle selection, Home/End jump to ends.',
      },
    },
  },
} satisfies Meta<typeof RadioGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

const SAMPLE_CONNECTIONS = [
  {id: 'conn-1', name: 'GitHub Source Control', subtitle: 'github · acme'},
  {id: 'conn-2', name: 'Debug', subtitle: 'debug · debug'},
  {id: 'conn-3', name: 'Other GitHub Source', subtitle: 'github · acme-fork'},
];

export const Default: Story = {
  render: () => {
    function ControlledRadioGroup() {
      const [value, setValue] = useState<string>('conn-1');
      return (
        <div className="flex w-[420px] flex-col gap-10">
          <Label id="connection-picker-label">Source connection</Label>
          <RadioGroup
            aria-labelledby="connection-picker-label"
            value={value}
            onValueChange={setValue}
          >
            {SAMPLE_CONNECTIONS.map((connection) => (
              <RadioGroupItem key={connection.id} value={connection.id}>
                <Text size="sm" bold>
                  {connection.name}
                </Text>
                <Text size="xs" className="text-foreground-neutral-muted">
                  {connection.subtitle}
                </Text>
              </RadioGroupItem>
            ))}
          </RadioGroup>
        </div>
      );
    }
    return <ControlledRadioGroup />;
  },
};

export const States: Story = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-10">
      <Label>States preview</Label>
      <RadioGroup defaultValue="conn-2">
        <RadioGroupItem value="conn-1">
          <Text size="sm" bold>
            Default
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            Unselected
          </Text>
        </RadioGroupItem>
        <RadioGroupItem value="conn-2">
          <Text size="sm" bold>
            Selected
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            data-state=&quot;checked&quot;
          </Text>
        </RadioGroupItem>
        <RadioGroupItem value="conn-3" className="hover">
          <Text size="sm" bold>
            Hover
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            Pseudo-class preview
          </Text>
        </RadioGroupItem>
        <RadioGroupItem value="conn-4" className="focus">
          <Text size="sm" bold>
            Focus visible
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            Keyboard focus ring
          </Text>
        </RadioGroupItem>
        <RadioGroupItem value="conn-5" disabled>
          <Text size="sm" bold>
            Disabled
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            Not selectable
          </Text>
        </RadioGroupItem>
      </RadioGroup>
    </div>
  ),
  parameters: {
    pseudo: {
      hover: '.hover',
      focusVisible: '.focus',
    },
  },
};

export const SingleOption: Story = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-10">
      <Label>Source connection</Label>
      <RadioGroup defaultValue="only-one">
        <RadioGroupItem value="only-one">
          <Text size="sm" bold>
            Only one option
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            Pre-selected; useful when there is exactly one connection.
          </Text>
        </RadioGroupItem>
      </RadioGroup>
    </div>
  ),
};
