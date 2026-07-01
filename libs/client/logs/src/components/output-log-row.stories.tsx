import {LogRows} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import type {OutputLogRecord} from '#core/log-tree.js';
import {OutputLogRow} from './output-log-row.js';

const ESC = String.fromCharCode(27);
const origin = new Date('2026-06-23T10:00:00.000Z').getTime();

const record = (
  data: string,
  stream: 'stdout' | 'stderr' = 'stdout',
  offsetSeconds = 0,
): OutputLogRecord => ({
  v: 1,
  ts: origin + offsetSeconds * 1000,
  type: 'output',
  stream,
  data,
});

const meta = {
  title: 'Logs/OutputLogRow',
  component: OutputLogRow,
  parameters: {layout: 'padded'},
  tags: ['autodocs'],
} satisfies Meta<typeof OutputLogRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <div className="max-w-3xl">
      <LogRows>
        <OutputLogRow
          record={record('transforming (1284) src/index.tsx\n', 'stdout', 0)}
          lineNumber={1}
        />
        <OutputLogRow
          record={record(
            `${ESC}[32m✓${ESC}[0m built ${ESC}[34m1284${ESC}[0m modules\n`,
            'stdout',
            1,
          )}
          lineNumber={2}
        />
        <OutputLogRow
          record={record('warn: deprecated glob@7, upgrade to glob@10\n', 'stderr', 2)}
          lineNumber={3}
        />
        <OutputLogRow
          record={record('FAIL client.test.ts > retries on 503\n', 'stderr', 3)}
          lineNumber={4}
        />
        <OutputLogRow record={record('done in 412ms\n', 'stdout', 4)} lineNumber={5} />
      </LogRows>
    </div>
  ),
};

export const LongLine: Story = {
  render: () => (
    <div className="max-w-md">
      <LogRows>
        <OutputLogRow
          record={record(
            'ERROR TypeError: Cannot read properties of undefined (reading "id") at withRetry (src/api/retry.ts:42:18) at async runStep (src/runner/step.ts:118:7)\n',
            'stderr',
            0,
          )}
          lineNumber={120}
        />
      </LogRows>
    </div>
  ),
};
