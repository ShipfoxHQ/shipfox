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

/** Collapsed disclosure: the header shows its label, the collapsed-only summary, and a trailing slot. */
export const Disclosure: Story = {
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

/** Open disclosure with the left rail. The summary is hidden once expanded. */
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

/**
 * Folding log groups: `rail={false}` and nested `LogRow`s carrying their own
 * indent. The header takes a `timestamp` like any row. Past a sane depth the app
 * renderer should flatten — the primitive itself leaves indent unbounded.
 */
export const Group: Story = {
  render: () => (
    <div className="max-w-2xl">
      <LogRows timestamps="rel" timestampOrigin={origin}>
        <LogDisclosure defaultOpen indent={0}>
          <LogDisclosureTrigger timestamp={at(0)} trailing={<>732ms</>}>
            Build
          </LogDisclosureTrigger>
          <LogDisclosureContent rail={false}>
            <LogDisclosure defaultOpen indent={1}>
              <LogDisclosureTrigger timestamp={at(0.1)} trailing={<>213ms</>}>
                Typecheck
              </LogDisclosureTrigger>
              <LogDisclosureContent rail={false}>
                <LogRow indent={2} timestamp={at(0.2)}>
                  <LogContent variant="code">tsc --noEmit</LogContent>
                </LogRow>
              </LogDisclosureContent>
            </LogDisclosure>
            <LogDisclosure indent={1}>
              <LogDisclosureTrigger timestamp={at(0.4)} trailing={<>519ms</>}>
                Bundle
              </LogDisclosureTrigger>
              <LogDisclosureContent rail={false}>
                <LogRow indent={2} timestamp={at(0.5)}>
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

/** The `trailing` slot can hold an interactive control; clicking it must not toggle the section. */
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

/** `selected` marks the cursor row for keyboard traversal; the header carries `aria-current`. */
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

/** `chevron="none"` drops the glyph; the caller supplies another open/closed cue (here, the summary). */
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

/** Click the header to toggle: `aria-expanded` flips and the collapsed-only summary hides. */
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

/** Controlled open state, driven from outside the component. */
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
};
