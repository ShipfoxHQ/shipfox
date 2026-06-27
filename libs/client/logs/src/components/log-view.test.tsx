import type {LogRecord} from '@shipfox/api-logs-dto';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {LogView, LogViewSkeleton} from './log-view.js';

const ts = new Date('2026-06-23T10:00:00.000Z').getTime();
const THINKING_BUTTON_NAME = /thinking/i;

const output = (data: string): LogRecord => ({
  v: 1,
  ts,
  type: 'output',
  stream: 'stdout',
  data,
});
const agentSession = (data: unknown, offsetMs = 0): LogRecord => ({
  v: 1,
  ts: ts + offsetMs,
  type: 'agent_session',
  data: typeof data === 'string' ? data : JSON.stringify(data),
});

describe('LogView', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('renders the complete empty state for an empty closed stream', () => {
    render(<LogView records={[]} />);

    expect(screen.getByText('Step produced no output')).toBeDefined();
    expect(
      screen.getByText('This log stream closed without session entries or process output.'),
    ).toBeDefined();
    expect(screen.getByRole('log')).toBeDefined();
  });

  test('renders the pending empty state for an empty open stream', () => {
    render(<LogView records={[]} emptyState="pending" />);

    expect(screen.getByText('No output yet')).toBeDefined();
    expect(screen.getByText('New lines will appear here as the step writes them.')).toBeDefined();
    expect(screen.queryByText('Step produced no output')).toBeNull();
  });

  test('renders no-output copy before the end marker for an end-marker-only stream', () => {
    render(<LogView records={[{v: 1, ts, type: 'end', total_bytes: 0}]} />);

    expect(screen.getByText('Step produced no output')).toBeDefined();
    expect(screen.getByText('End of log')).toBeDefined();
    expect(screen.getByText('0 lines · 0 B · 0ms')).toBeDefined();
  });

  test.each([
    {record: {v: 1, ts, type: 'runner_lost'} as const, label: 'Runner disconnected'},
    {record: {v: 1, ts, type: 'gap', dropped_bytes: 2048} as const, label: 'Output missing'},
    {record: {v: 1, ts, type: 'capped'} as const, label: 'Log size limit reached'},
  ])('does not show no-output copy for a $record.type marker-only stream', ({record, label}) => {
    render(<LogView records={[record]} />);

    expect(screen.getByText(label)).toBeDefined();
    expect(screen.queryByText('Step produced no output')).toBeNull();
    expect(screen.queryByText('No output yet')).toBeNull();
  });

  test('does not render empty copy when output exists', () => {
    render(<LogView records={[output('hello\n')]} />);

    expect(screen.getByText('hello')).toBeDefined();
    expect(screen.queryByText('Step produced no output')).toBeNull();
    expect(screen.queryByText('No output yet')).toBeNull();
  });

  test('renders assistant session text and collapsed thinking', () => {
    render(
      <LogView
        records={[
          agentSession({
            type: 'message',
            message: {
              role: 'assistant',
              content: [
                {type: 'text', text: 'I will inspect the failure.'},
                {type: 'thinking', text: 'The stack trace points at validation.'},
              ],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('I will inspect the failure.')).toBeDefined();
    expect(screen.getByRole('button', {name: THINKING_BUTTON_NAME})).toBeDefined();
    expect(screen.queryByText('The stack trace points at validation.')).toBeNull();

    fireEvent.click(screen.getByRole('button', {name: THINKING_BUTTON_NAME}));

    expect(screen.getByText('The stack trace points at validation.')).toBeDefined();
  });

  test('renders tool calls with awaiting state until a result appears later in the stream', () => {
    render(
      <LogView
        records={[
          agentSession({
            type: 'message',
            message: {
              role: 'assistant',
              content: [{type: 'toolCall', id: 'call-1', name: 'edit_file', arguments: {}}],
            },
          }),
          output('stdout between call and result\n'),
          agentSession(
            {
              type: 'message',
              message: {
                toolCallId: 'call-1',
                toolName: 'edit_file',
                content: 'patched',
                isError: false,
              },
            },
            1,
          ),
        ]}
      />,
    );

    expect(screen.getByText('tool edit_file')).toBeDefined();
    expect(screen.getByText('stdout between call and result')).toBeDefined();
    expect(screen.getByText('result edit_file')).toBeDefined();
    expect(screen.queryByText('awaiting result')).toBeNull();
  });

  test('renders unknown session entries without crashing', () => {
    render(<LogView records={[agentSession({type: 'future_entry', payload: {value: true}})]} />);

    expect(screen.getByText('Unknown session entry: future_entry')).toBeDefined();
  });

  test('truncates large payloads with a show-more control', () => {
    render(
      <LogView
        records={[
          agentSession({
            type: 'message',
            message: {
              role: 'assistant',
              content: [{type: 'text', text: 'x'.repeat(1500)}],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByRole('button', {name: 'show more'})).toBeDefined();
  });

  test('anchors terminal failures when requested', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(
      <LogView
        anchorToFailure
        records={[
          output('setup\n'),
          agentSession({
            type: 'message',
            message: {
              role: 'assistant',
              content: [{type: 'text', text: 'I cannot continue.'}],
              stopReason: 'error',
            },
          }),
        ]}
      />,
    );

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({block: 'center'}));
  });
});

describe('LogViewSkeleton', () => {
  test('keeps visual log chrome without exposing fake log content', () => {
    const {container} = render(<LogViewSkeleton rows={3} />);

    expect(screen.queryByRole('log')).toBeNull();
    expect(container.querySelector('[data-slot="log-rows"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(container.querySelectorAll('[data-slot="log-row"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });
});
