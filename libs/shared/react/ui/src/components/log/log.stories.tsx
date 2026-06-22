import type {Meta, StoryObj} from '@storybook/react';
import {Badge} from '#components/badge/index.js';
import {Code} from '#components/typography/index.js';
import {LogContent} from './log-content.js';
import {LogHeader} from './log-header.js';
import {LogRow} from './log-row.js';
import {LogRows} from './log-rows.js';

const meta = {
  title: 'Components/Log',
  component: LogRows,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    timestamps: {control: 'inline-radio', options: ['off', 'rel', 'abs']},
    wrap: {control: 'boolean'},
    showLineNumbers: {control: 'boolean'},
  },
  args: {
    timestamps: 'off',
    wrap: false,
    showLineNumbers: true,
  },
} satisfies Meta<typeof LogRows>;

export default meta;

type Story = StoryObj<typeof meta>;

const origin = new Date('2026-06-22T14:32:00.000Z');
const at = (offsetSeconds: number) => new Date(origin.getTime() + offsetSeconds * 1000);

const ansiBuild = `${String.fromCharCode(27)}[32m✓${String.fromCharCode(27)}[0m built ${String.fromCharCode(27)}[34m1284${String.fromCharCode(27)}[0m modules · ${String.fromCharCode(27)}[1;31m1 error${String.fromCharCode(27)}[0m`;

const Glyph = ({className, children}: {className: string; children: string}) => (
  <span className={className}>{children}</span>
);

export const Default: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogRows {...args} origin={origin} className="max-h-72">
        <LogRow lineNumber={34} timestamp={at(9)}>
          <LogContent variant="code">transforming (1284) src/index.tsx</LogContent>
        </LogRow>
        <LogRow lineNumber={35} timestamp={at(9.4)}>
          <LogContent variant="code">
            <Glyph className="font-bold text-green-500 dark:text-green-400">{'✓ '}</Glyph>
            1284 modules transformed
          </LogContent>
        </LogRow>
        <LogRow lineNumber={36} timestamp={at(9.7)} selected>
          <LogContent variant="code">dist/assets/index-a3f9b1c2.js</LogContent>
        </LogRow>
        <LogRow lineNumber={37} timestamp={at(10)}>
          <LogContent variant="code" className="text-foreground-neutral-muted">
            built in 412ms
          </LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

export const OutputLine: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows timestamps="abs" origin={origin}>
        <LogRow lineNumber={42} timestamp={at(9)}>
          <LogContent variant="code" ansi>
            {ansiBuild}
          </LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

export const AgentTurn: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows timestamps="abs" origin={origin}>
        <LogRow tone="info" lineNumber={57} timestamp={at(11)}>
          <LogHeader>
            <Glyph className="text-blue-500 dark:text-blue-400">{'❯'}</Glyph>
            <Badge variant="info">You</Badge>
          </LogHeader>
          <LogContent>Make sure the 503 retry test passes.</LogContent>
        </LogRow>
        <LogRow tone="accent" lineNumber={58} timestamp={at(13)}>
          <LogHeader end={<>claude-sonnet-4-5 · $0.084 · 2.1s</>}>
            <Glyph className="text-purple-500 dark:text-purple-400">{'✦'}</Glyph>
            <Badge variant="feature">Assistant</Badge>
          </LogHeader>
          <LogContent>Fixed the off-by-one in withRetry().</LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

export const TimelineMarker: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <LogRow lineNumber={88}>
          <LogContent variant="code">writing dist/assets/index-a3f9b1c2.js</LogContent>
        </LogRow>
        <LogRow tone="warning">
          <LogContent>
            <span className="inline-flex w-full items-center gap-8 text-orange-600 dark:text-orange-300">
              {'⚠'} <b>18,432 bytes dropped</b>
              <span className="h-px flex-1 border-t border-dashed border-current opacity-40" />
            </span>
          </LogContent>
        </LogRow>
        <LogRow tone="error">
          <LogContent>
            <span className="inline-flex items-center gap-8 font-bold text-red-600 dark:text-red-400">
              {'■'} Runner lost
              <span className="font-normal opacity-80">— log incomplete</span>
            </span>
          </LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        {(['default', 'info', 'accent', 'success', 'warning', 'error'] as const).map(
          (tone, index) => (
            <LogRow key={tone} lineNumber={index + 1} tone={tone}>
              <LogContent variant="code">tone="{tone}"</LogContent>
            </LogRow>
          ),
        )}
      </LogRows>
    </div>
  ),
};

export const Timestamps: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-16 md:grid-cols-3">
      {(['off', 'rel', 'abs'] as const).map((mode) => (
        <div key={mode} className="flex flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            timestamps="{mode}"
          </Code>
          <LogRows timestamps={mode} origin={origin}>
            <LogRow lineNumber={17} timestamp={at(0.412)}>
              <LogContent variant="code">resolving dependencies</LogContent>
            </LogRow>
            <LogRow lineNumber={18} timestamp={at(0.53)}>
              <LogContent variant="code">linking 318 packages</LogContent>
            </LogRow>
            <LogRow lineNumber={19} timestamp={at(65.3)}>
              <LogContent variant="code">done</LogContent>
            </LogRow>
          </LogRows>
        </div>
      ))}
    </div>
  ),
};

export const Wrap: Story = {
  render: () => {
    const long =
      'ERROR  TypeError: Cannot read properties of undefined (reading "id") at withRetry (src/api/retry.ts:42:18) at async runStep (src/runner/step.ts:118:7)';
    return (
      <div className="flex max-w-3xl flex-col gap-16">
        <div className="flex max-w-md flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            wrap=false — the line scrolls; a right fade marks the truncation
          </Code>
          <LogRows wrap={false}>
            <LogRow lineNumber={120} tone="error">
              <LogContent variant="code">{long}</LogContent>
            </LogRow>
            <LogRow lineNumber={121}>
              <LogContent variant="code">resuming after the failure</LogContent>
            </LogRow>
          </LogRows>
        </div>
        <div className="flex max-w-md flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            wrap=true — continuation lines hang-indent under the first
          </Code>
          <LogRows wrap>
            <LogRow lineNumber={120} tone="error">
              <LogContent variant="code">{long}</LogContent>
            </LogRow>
            <LogRow lineNumber={121}>
              <LogContent variant="code">resuming after the failure</LogContent>
            </LogRow>
          </LogRows>
        </div>
      </div>
    );
  },
};

export const AnsiOutput: Story = {
  render: () => {
    const e = String.fromCharCode(27);
    const lines = [
      `${e}[32m✓${e}[0m ${e}[1mbuild${e}[0m succeeded in ${e}[34m412ms${e}[0m`,
      `${e}[33mWARN${e}[0m ${e}[2mdeprecated${e}[0m glob@7 · ${e}[4mupgrade to glob@10${e}[0m`,
      `${e}[1;31mFAIL${e}[0m client.test.ts ${e}[31m> retries on 503${e}[0m`,
    ];
    return (
      <div className="max-w-3xl">
        <LogRows>
          {lines.map((line, index) => (
            <LogRow key={line} lineNumber={index + 1}>
              <LogContent variant="code" ansi>
                {line}
              </LogContent>
            </LogRow>
          ))}
        </LogRows>
      </div>
    );
  },
};

export const Interleaved: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows timestamps="abs" origin={origin} className="max-h-96">
        <LogRow lineNumber={41} timestamp={at(8.12)}>
          <LogContent variant="code">
            <Glyph className="text-green-500 dark:text-green-400">{'$ '}</Glyph>pnpm vitest run
          </LogContent>
        </LogRow>
        <LogRow lineNumber={42} timestamp={at(9.0)} tone="accent">
          <LogHeader end={<>$0.084 · 2.1s</>}>
            <Glyph className="text-purple-500 dark:text-purple-400">{'✦'}</Glyph>
            <Badge variant="feature">Assistant</Badge>
          </LogHeader>
          <LogContent>Re-running the failing shard.</LogContent>
        </LogRow>
        <LogRow lineNumber={43} timestamp={at(9.22)}>
          <LogContent variant="code">
            <Glyph className="text-blue-500 dark:text-blue-400">{'⚙ '}</Glyph>
            <span className="font-bold text-blue-600 dark:text-blue-400">read_file</span>
            <span className="text-foreground-neutral-muted"> src/api/client.ts</span>
          </LogContent>
        </LogRow>
        <LogRow lineNumber={44} timestamp={at(9.54)}>
          <LogContent variant="code" className="text-foreground-neutral-muted">
            <Glyph className="font-bold text-green-500 dark:text-green-400">{'✓ '}</Glyph>
            read_file · 64 lines
          </LogContent>
        </LogRow>
        <LogRow lineNumber={45} timestamp={at(10.12)} tone="error">
          <LogContent variant="code">
            <span className="font-bold text-red-600 dark:text-red-400">FAIL </span>
            client.test.ts &gt; retries on 503
          </LogContent>
        </LogRow>
        <LogRow tone="warning">
          <LogContent>
            <span className="inline-flex w-full items-center gap-8 text-orange-600 dark:text-orange-300">
              {'⚠'} <b>End of log · 1.5 KB</b>
              <span className="h-px flex-1 border-t border-dashed border-current opacity-40" />
            </span>
          </LogContent>
        </LogRow>
      </LogRows>
    </div>
  ),
};

export const Slots: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-col gap-16">
      <div className="flex flex-col gap-8">
        <Code variant="label" className="text-foreground-neutral-subtle">
          LogHeader
        </Code>
        <LogRows>
          <LogRow lineNumber={1}>
            <LogHeader end={<>claude-sonnet-4-5 · $0.084</>}>
              <Glyph className="text-purple-500 dark:text-purple-400">{'✦'}</Glyph>
              <Badge variant="feature">Assistant</Badge>
            </LogHeader>
          </LogRow>
          <LogRow lineNumber={2}>
            <LogHeader end={<>64 lines</>}>
              <Glyph className="text-blue-500 dark:text-blue-400">{'⚙'}</Glyph>
              <span className="font-bold text-blue-600 dark:text-blue-400">read_file</span>
            </LogHeader>
          </LogRow>
        </LogRows>
      </div>
      <div className="flex flex-col gap-8">
        <Code variant="label" className="text-foreground-neutral-subtle">
          LogContent
        </Code>
        <LogRows>
          <LogRow lineNumber={1}>
            <LogContent variant="text">Prose body — wraps like normal text.</LogContent>
          </LogRow>
          <LogRow lineNumber={2}>
            <LogContent variant="code">mono · whitespace preserved</LogContent>
          </LogRow>
          <LogRow lineNumber={3}>
            <LogContent variant="code" ansi>
              {`${String.fromCharCode(27)}[32m✓${String.fromCharCode(27)}[0m code + ansi`}
            </LogContent>
          </LogRow>
        </LogRows>
      </div>
    </div>
  ),
};
