import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {expect, userEvent, within} from 'storybook/test';
import {Button} from '../button/index.js';
import {LogContent} from './log-content.js';
import {LogDisclosure, LogDisclosureContent, LogDisclosureTrigger} from './log-disclosure.js';
import {LogRow} from './log-row.js';
import {LogRows} from './log-rows.js';

const origin = new Date('2026-06-22T14:32:00.000Z');
const at = (offsetSeconds: number) => new Date(origin.getTime() + offsetSeconds * 1000);

const THINKING_REGEX = /thinking/i;
const TOOL_RESULT_REGEX = /tool result/i;
const COPY_REGEX = /copy/i;
const EXPAND_REGEX = /expand/i;
const COLLAPSE_REGEX = /collapse/i;

const meta = {
  title: 'Components/Log/Disclosure',
  component: LogDisclosure,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'One collapsible primitive for the log surface, built on `Collapsible`. With the default left **rail** it is a disclosure (agent thinking, tool-result output, compaction summaries); with `rail={false}` around nested `LogRow`s it is a folding **log group** (GitHub `::group::`). Header, rail, and rows share `LogRowFrame`, so everything stays gutter-aligned. The toggle is a button filling all non-`trailing` space; `trailing` sits outside it and can host its own controls.',
      },
    },
  },
} satisfies Meta<typeof LogDisclosure>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <div className="max-w-2xl">
      <LogRows>
        <LogDisclosure indent={1}>
          <LogDisclosureTrigger summary={<>47 words</>} trailing={<>2.1s</>}>
            Thinking
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            <LogContent>
              The mock expects one more attempt than fires, so the retry budget is off by one.
            </LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      </LogRows>
    </div>
  ),
};

export const Open: Story = {
  render: () => (
    <div className="max-w-2xl">
      <LogRows>
        <LogDisclosure defaultOpen indent={1}>
          <LogDisclosureTrigger summary={<>47 words</>} trailing={<>2.1s</>}>
            Thinking
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            <LogContent>
              The mock expects one more attempt than fires, so the retry budget is off by one.
            </LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      </LogRows>
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', {name: THINKING_REGEX});

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText('47 words')).not.toBeVisible();
  },
};

export const Group: Story = {
  render: () => (
    <div className="max-w-2xl">
      <LogRows timestamps="rel" timestampOrigin={origin}>
        <LogRow lineNumber={1} timestamp={at(0)}>
          <LogContent variant="code">$ turbo build</LogContent>
        </LogRow>
        <LogDisclosure defaultOpen indent={0}>
          <LogDisclosureTrigger lineNumber={2} timestamp={at(0.05)} trailing={<>732ms</>}>
            Build
          </LogDisclosureTrigger>
          <LogDisclosureContent rail={false}>
            <LogDisclosure defaultOpen indent={1}>
              <LogDisclosureTrigger lineNumber={3} timestamp={at(0.1)} trailing={<>213ms</>}>
                Typecheck
              </LogDisclosureTrigger>
              <LogDisclosureContent rail={false}>
                <LogRow lineNumber={4} indent={2} timestamp={at(0.2)}>
                  <LogContent variant="code">tsc --noEmit</LogContent>
                </LogRow>
              </LogDisclosureContent>
            </LogDisclosure>
            <LogDisclosure indent={1}>
              <LogDisclosureTrigger lineNumber={5} timestamp={at(0.4)} trailing={<>519ms</>}>
                Bundle
              </LogDisclosureTrigger>
              <LogDisclosureContent rail={false}>
                <LogRow lineNumber={6} indent={2} timestamp={at(0.5)}>
                  <LogContent variant="code">transforming (1284) src/index.tsx</LogContent>
                </LogRow>
              </LogDisclosureContent>
            </LogDisclosure>
          </LogDisclosureContent>
        </LogDisclosure>
      </LogRows>
    </div>
  ),
};

export const Trailing: Story = {
  render: () => (
    <div className="max-w-2xl">
      <LogRows>
        <LogDisclosure indent={1}>
          <LogDisclosureTrigger
            summary={<>read_file · 64 lines</>}
            trailing={
              <Button size="2xs" variant="transparent">
                Copy
              </Button>
            }
          >
            Tool result
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            <LogContent variant="code">
              export function withRetry() {'{'} … {'}'}
            </LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      </LogRows>
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const trigger = canvas.getByRole('button', {name: TOOL_RESULT_REGEX});

    await user.click(canvas.getByRole('button', {name: COPY_REGEX}));

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

export const Selected: Story = {
  render: () => (
    <div className="max-w-2xl">
      <LogRows>
        <LogDisclosure indent={1}>
          <LogDisclosureTrigger selected summary={<>47 words</>} trailing={<>2.1s</>}>
            Thinking
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            <LogContent>The cursor row stays distinct from a plain hover.</LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      </LogRows>
    </div>
  ),
  play: async ({canvasElement}) => {
    await expect(canvasElement.querySelector('[aria-current="true"]')).not.toBeNull();
  },
};

export const ChevronNone: Story = {
  render: () => (
    <div className="max-w-2xl">
      <LogRows>
        <LogDisclosure indent={1}>
          <LogDisclosureTrigger chevron="none" summary={<>show 12 hidden lines</>}>
            Compaction
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            <LogContent variant="code">… 12 lines elided …</LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      </LogRows>
    </div>
  ),
};

export const Toggle: Story = {
  render: () => (
    <div className="max-w-2xl">
      <LogRows>
        <LogDisclosure indent={1}>
          <LogDisclosureTrigger summary={<>47 words</>} trailing={<>2.1s</>}>
            Thinking
          </LogDisclosureTrigger>
          <LogDisclosureContent>
            <LogContent>The retry budget is off by one.</LogContent>
          </LogDisclosureContent>
        </LogDisclosure>
      </LogRows>
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const trigger = canvas.getByRole('button', {name: THINKING_REGEX});

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.getByText('47 words')).toBeVisible();

    await user.click(trigger);

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText('47 words')).not.toBeVisible();
  },
};

export const Controlled: Story = {
  render: () => {
    function ControlledDisclosure() {
      const [open, setOpen] = useState(false);
      return (
        <div className="flex max-w-2xl flex-col gap-8">
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Collapse' : 'Expand'}
          </Button>
          <LogRows>
            <LogDisclosure open={open} onOpenChange={setOpen} indent={1}>
              <LogDisclosureTrigger summary={<>47 words</>} trailing={<>2.1s</>}>
                Thinking
              </LogDisclosureTrigger>
              <LogDisclosureContent>
                <LogContent>Driven by the button above via `open` / `onOpenChange`.</LogContent>
              </LogDisclosureContent>
            </LogDisclosure>
          </LogRows>
        </div>
      );
    }

    return <ControlledDisclosure />;
  },
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup();
    const trigger = canvas.getByRole('button', {name: THINKING_REGEX});

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.getByRole('button', {name: EXPAND_REGEX})).toBeVisible();

    await user.click(canvas.getByRole('button', {name: EXPAND_REGEX}));

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('button', {name: COLLAPSE_REGEX})).toBeVisible();

    await user.click(trigger);

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.getByRole('button', {name: EXPAND_REGEX})).toBeVisible();
  },
};
