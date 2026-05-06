import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {Icon} from '../icon';
import {Popover, PopoverContent, PopoverTrigger} from '../popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  CommandTrigger,
} from './command';

const meta = {
  title: 'Components/Command',
  component: Command,
  tags: ['autodocs'],
} satisfies Meta<typeof Command>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Command className="rounded-10 shadow-tooltip max-w-400">
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>
            <Icon name="calendar2Line" className="size-16 mr-8" />
            <span>Calendar</span>
          </CommandItem>
          <CommandItem>
            <Icon name="emotion2Line" className="size-16 mr-8" />
            <span>Search Emoji</span>
          </CommandItem>
          <CommandItem>
            <Icon name="calculatorLine" className="size-16 mr-8" />
            <span>Calculator</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <Icon name="user3Line" className="size-16 mr-8" />
            <span>Profile</span>
            <CommandShortcut>⌘P</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Icon name="mailLine" className="size-16 mr-8" />
            <span>Mail</span>
            <CommandShortcut>⌘M</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Icon name="settings3Line" className="size-16 mr-8" />
            <span>Settings</span>
            <CommandShortcut>⌘S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};

export const Combobox: Story = {
  render: () => {
    const frameworks = [
      {value: 'next.js', label: 'Next.js', icon: 'reactjsLine' as const},
      {value: 'sveltekit', label: 'SvelteKit', icon: 'svelteLine' as const},
      {value: 'nuxt.js', label: 'Nuxt.js', icon: 'vuejsLine' as const},
      {value: 'remix', label: 'Remix', icon: 'reactjsLine' as const},
      {value: 'astro', label: 'Astro', icon: 'rocketLine' as const},
      {value: 'vue', label: 'Vue', icon: 'vuejsLine' as const},
      {value: 'react', label: 'React', icon: 'reactjsLine' as const},
    ];

    function ComboboxDemo() {
      const [open, setOpen] = useState(false);
      const [value, setValue] = useState('');

      return (
        <div className="flex flex-col gap-16">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <CommandTrigger className="w-280" placeholder="Select framework...">
                {value ? frameworks.find((framework) => framework.value === value)?.label : null}
              </CommandTrigger>
            </PopoverTrigger>
            <PopoverContent className="w-280 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search framework..." />
                <CommandList>
                  <CommandEmpty>No framework found.</CommandEmpty>
                  <CommandGroup>
                    {frameworks.map((framework) => (
                      <CommandItem
                        key={framework.value}
                        value={framework.value}
                        onSelect={(currentValue) => {
                          setValue(currentValue === value ? '' : currentValue);
                          setOpen(false);
                        }}
                      >
                        <Icon
                          name="check"
                          className={`size-16 mr-8 ${value === framework.value ? 'opacity-100' : 'opacity-0'}`}
                        />
                        <Icon name={framework.icon} className="size-16 mr-8" />
                        {framework.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {value && (
            <p className="text-sm text-foreground-neutral-muted">
              Selected: {frameworks.find((f) => f.value === value)?.label}
            </p>
          )}
        </div>
      );
    }

    return <ComboboxDemo />;
  },
};
