import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createRef} from 'react';
import {createIntegrationActionPresentationLookup} from '#core/integration-action.js';
import type {LogRecord} from '#core/log-model.js';
import {LogView, LogViewSkeleton} from './log-view.js';

const ts = new Date('2026-06-23T10:00:00.000Z').getTime();
const THINKING_BUTTON_NAME = /thinking/i;
const TOOL_BUTTON_NAME = /Tool/;
const RUN_COMMAND_BUTTON_NAME = /Run Command/;
const EDIT_FILE_BUTTON_NAME = /Edit File/;
const READ_FILE_BUTTON_NAME = /Read File/;
const INTEGRATION_BUTTON_NAME = /Linear · List Teams/;
const CLICKUP_BUTTON_NAME = /ClickUp · Read/;
const TWO_READS_BUTTON_NAME = /Read File, 2 reads/;
const ONE_READ_BUTTON_NAME = /Read File.*one.ts/;
const TWO_READ_BUTTON_NAME = /Read File.*two.ts/;
const THREE_READ_BUTTON_NAME = /Read File.*three.ts/;
const ONE_OF_TWO_READS_BUTTON_NAME = /1 of 2 reads/;

const output = (data: string): LogRecord => ({
  v: 1,
  ts,
  type: 'output',
  stream: 'stdout',
  data,
});
const groupStart = (groupId: string, name: string): LogRecord => ({
  v: 1,
  ts,
  type: 'group_start',
  groupId,
  parentGroupId: null,
  name,
});
const groupEnd = (groupId: string): LogRecord => ({
  v: 1,
  ts,
  type: 'group_end',
  groupId,
});
type AgentSessionRow = Extract<LogRecord, {type: 'agent_session'}>['row'];

const agentSession = (row: AgentSessionRow, offsetMs = 0): LogRecord => ({
  v: 1,
  ts: ts + offsetMs,
  type: 'agent_session',
  row,
});

function readRecords(id: string, path: string, offsetMs: number, completed = true): LogRecord[] {
  const records = [
    agentSession(
      {
        kind: 'tool-call',
        timestamp: ts + offsetMs,
        id,
        name: 'Read',
        input: JSON.stringify({file_path: path}),
      },
      offsetMs,
    ),
  ];
  if (completed)
    records.push(
      agentSession(
        {
          kind: 'tool-result',
          timestamp: ts + offsetMs + 1,
          toolCallId: id,
          toolName: 'Read',
          output: `${path} result`,
          isError: false,
        },
        offsetMs + 1,
      ),
    );
  return records;
}

describe('LogView', () => {
  test('keeps an opened read group and focused action stable when live reads arrive', () => {
    const twoReads = [...readRecords('one', 'one.ts', 0), ...readRecords('two', 'two.ts', 10)];
    const {rerender} = render(<LogView records={twoReads} />);
    const group = screen.getByRole('button', {name: TWO_READS_BUTTON_NAME});
    fireEvent.click(group);
    const first = screen.getByRole('button', {name: ONE_READ_BUTTON_NAME});
    act(() => first.focus());

    rerender(<LogView records={[...twoReads, ...readRecords('three', 'three.ts', 20)]} />);

    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(group).toHaveTextContent('3 reads');
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole('button', {name: THREE_READ_BUTTON_NAME})).toBeInTheDocument();
  });

  test('keeps a focused singleton visible when a second read completes', () => {
    const firstRead = readRecords('one', 'one.ts', 0);
    const secondCall = readRecords('two', 'two.ts', 10, false);
    const {rerender} = render(<LogView records={[...firstRead, ...secondCall]} />);
    const first = screen.getByRole('button', {name: ONE_READ_BUTTON_NAME});
    act(() => first.focus());

    rerender(<LogView records={[...firstRead, ...readRecords('two', 'two.ts', 10)]} />);

    expect(screen.getByRole('button', {name: TWO_READS_BUTTON_NAME})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(document.activeElement).toBe(first);
  });

  test('search opens a grouped read whose result alone matches', () => {
    render(
      <LogView
        search="two.ts result"
        records={[...readRecords('one', 'one.ts', 0), ...readRecords('two', 'two.ts', 10)]}
      />,
    );

    const group = screen.getByRole('button', {name: ONE_OF_TWO_READS_BUTTON_NAME});
    expect(group).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', {name: TWO_READ_BUTTON_NAME})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: ONE_READ_BUTTON_NAME})).not.toBeInTheDocument();
  });

  test('keeps the same history row in view when grouping shortens earlier content', () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    let messageTop = 100;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      let top = -100;
      if (this.dataset.activityAnchor === '3') top = messageTop;
      else if (this.dataset.activityAnchor === undefined) top = 0;
      return {
        top,
        bottom: top + (this.dataset.activityAnchor === undefined ? 200 : 20),
        left: 0,
        right: 200,
        width: 200,
        height: 20,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
      this: HTMLElement,
    ) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    });
    const first = readRecords('one', 'one.ts', 0);
    const pending = readRecords('two', 'two.ts', 10, false);
    const message = agentSession(
      {
        kind: 'message',
        timestamp: ts + 20,
        role: 'assistant',
        label: 'assistant',
        text: 'Inspecting history',
        meta: [],
        terminalFailure: false,
      },
      20,
    );
    const {rerender} = render(
      <div ref={scrollContainerRef}>
        <LogView
          records={[...first, ...pending, message]}
          scrollContainerRef={scrollContainerRef}
        />
      </div>,
    );
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) throw new Error('missing scroll container');
    Object.defineProperty(scrollContainer, 'scrollHeight', {configurable: true, value: 1000});
    Object.defineProperty(scrollContainer, 'clientHeight', {configurable: true, value: 200});
    scrollContainer.scrollTop = 300;
    fireEvent.scroll(scrollContainer);

    messageTop = 60;
    rerender(
      <div ref={scrollContainerRef}>
        <LogView
          records={[...first, ...pending, message, ...readRecords('two', 'two.ts', 10).slice(1)]}
          scrollContainerRef={scrollContainerRef}
        />
      </div>,
    );

    expect(scrollContainer.scrollTop).toBe(260);
  });
  test('shows resolved integration identity and structured recorded output', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'a',
            name: 'mcp__shipfox_integration_tools__tickets_main__list_teams',
            input: '{"workspace":"shipfox"}',
          }),
          agentSession(
            {
              kind: 'tool-result',
              timestamp: ts + 1,
              toolCallId: 'a',
              toolName: 'tool',
              output: '[{"name":"Engineering"}]',
              isError: false,
            },
            1,
          ),
        ]}
        actionPresentation={createIntegrationActionPresentationLookup([
          {
            provider: 'linear',
            connectionId: 'id',
            connectionSlug: 'tickets-main',
            toolId: 'list_teams',
            sensitivity: 'read',
          },
        ])}
      />,
    );
    const preview = screen.getByRole('button', {name: INTEGRATION_BUTTON_NAME});
    expect(screen.getByText('succeeded')).toHaveClass('sr-only');
    const count = screen.getByText('1 item');
    expect(count.parentElement).toHaveClass('gap-inline');
    expect(count.nextElementSibling).toHaveClass('border-l');
    expect(count.nextElementSibling?.nextElementSibling).toHaveTextContent('1ms');
    fireEvent.click(preview);
    const result = screen.getByText('Engineering');
    expect(result.closest('.bg-background-contrast-base')).toBeInTheDocument();
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
    expect(screen.queryByText('{"workspace":"shipfox"}')).not.toBeInTheDocument();
  });

  test('shows nested objects and arrays as labeled groups', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'grouped',
            name: 'example_main__read',
            input: '{}',
          }),
          agentSession(
            {
              kind: 'tool-result',
              timestamp: ts + 1,
              toolCallId: 'grouped',
              toolName: 'read',
              output: '{"fields":{"summary":"Review"},"results":[{"title":"Launch"}]}',
              isError: false,
            },
            1,
          ),
        ]}
        actionPresentation={createIntegrationActionPresentationLookup([
          {
            provider: 'example',
            connectionId: 'id',
            connectionSlug: 'example-main',
            toolId: 'read',
            sensitivity: 'read',
          },
        ])}
      />,
    );

    fireEvent.click(screen.getByText('Example · Read'));

    expect(screen.getByText('fields').nextElementSibling).toContainElement(
      screen.getByText('summary'),
    );
    expect(screen.getByText('results · 1 item').nextElementSibling).toContainElement(
      screen.getByText('Item 1'),
    );
    expect(screen.getByText('Item 1').nextElementSibling).toContainElement(
      screen.getByText('title'),
    );
  });

  test('keeps deeply nested integration output viewable', () => {
    const nested = `${'['.repeat(12_000)}0${']'.repeat(12_000)}`;
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'nested',
            name: 'customer_primary__read',
            input: '{}',
          }),
          agentSession(
            {
              kind: 'tool-result',
              timestamp: ts + 1,
              toolCallId: 'nested',
              toolName: 'tool',
              output: nested,
              isError: false,
            },
            1,
          ),
        ]}
        actionPresentation={createIntegrationActionPresentationLookup([
          {
            provider: 'clickup',
            connectionId: 'id',
            connectionSlug: 'customer-primary',
            toolId: 'read',
            sensitivity: 'read',
          },
        ])}
      />,
    );
    fireEvent.click(screen.getByRole('button', {name: CLICKUP_BUTTON_NAME}));
    expect(screen.getByText('[Nested value omitted]')).toBeInTheDocument();
  });

  let scrollIntoViewDescriptor: PropertyDescriptor | undefined;
  let scrollIntoViewWasStubbed = false;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (scrollIntoViewWasStubbed) {
      if (scrollIntoViewDescriptor != null) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
    scrollIntoViewDescriptor = undefined;
    scrollIntoViewWasStubbed = false;
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
    render(<LogView records={[{v: 1, ts, type: 'end', totalBytes: 0}]} />);

    expect(screen.getByText('Step produced no output')).toBeDefined();
    expect(screen.getByText('End of log')).toBeDefined();
    expect(screen.getByText('0 lines · 0 B · 0ms')).toBeDefined();
  });

  test.each([
    {record: {v: 1, ts, type: 'runner_lost'} as const, label: 'Runner disconnected'},
    {record: {v: 1, ts, type: 'timed_out'} as const, label: 'Execution timed out'},
    {record: {v: 1, ts, type: 'run_cancelled'} as const, label: 'Run cancelled'},
    {record: {v: 1, ts, type: 'gap', droppedBytes: 2048} as const, label: 'Output missing'},
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

  test('renders timestamps and forwards the timestamp shortcut', () => {
    const onTimestampsClick = vi.fn();
    render(
      <LogView
        records={[output('hello\n')]}
        timestamps="rel"
        onTimestampsClick={onTimestampsClick}
      />,
    );

    fireEvent.click(screen.getByText('+0.000'));

    expect(onTimestampsClick).toHaveBeenCalledOnce();
  });

  test('ends open groups and explains a truncated stream without a terminal marker', () => {
    render(
      <LogView truncated records={[groupStart('build', 'Build'), output('partial output\n')]} />,
    );

    expect(screen.getByText('Log stream incomplete')).toBeInTheDocument();
    expect(screen.getByText('some final output may be missing')).toBeInTheDocument();
    expect(screen.getByText('incomplete')).toBeInTheDocument();
  });

  test('renders only the incomplete state for an empty truncated stream', () => {
    render(<LogView truncated records={[]} />);

    expect(screen.getByText('Log stream incomplete')).toBeInTheDocument();
    expect(screen.queryByText('Step produced no output')).not.toBeInTheDocument();
    expect(screen.queryByText('No output yet')).not.toBeInTheDocument();
  });

  test('does not duplicate an authoritative terminal marker for a truncated stream', () => {
    render(<LogView truncated records={[{v: 1, ts, type: 'timed_out'}]} />);

    expect(screen.getByText('Execution timed out')).toBeInTheDocument();
    expect(screen.queryByText('Log stream incomplete')).not.toBeInTheDocument();
  });

  test('filters output and session rows by the log search term', () => {
    render(
      <LogView
        search="failure"
        records={[
          output('setup complete\n'),
          output('failure: test failed\n'),
          agentSession({
            kind: 'message',
            timestamp: ts,
            role: 'assistant',
            label: 'assistant',
            meta: [],
            text: 'The failure is in the validation step.',
            terminalFailure: false,
          }),
        ]}
      />,
    );

    expect(screen.getByText('failure: test failed')).toBeDefined();
    expect(screen.getByText('The failure is in the validation step.')).toBeDefined();
    expect(screen.queryByText('setup complete')).toBeNull();
    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off');
    expect(screen.getByRole('status')).toHaveTextContent('Log search updated for “failure”.');
  });

  test('opens matching groups and filters their children', () => {
    render(
      <LogView
        search="success"
        records={[
          groupStart('build', 'Build'),
          output('setup complete\n'),
          output('Success: compiled\n'),
          groupEnd('build'),
        ]}
      />,
    );

    expect(screen.getByText('Success: compiled')).toBeInTheDocument();
    expect(screen.queryByText('setup complete')).not.toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  test('normalizes search text and restores all rows when search is cleared', async () => {
    const records = [output('Failure: validation failed\n'), output('success: recovered\n')];
    const {rerender} = render(<LogView search="  FAILURE  " records={records} />);

    await waitFor(() => expect(screen.getByText('Failure: validation failed')).toBeInTheDocument());
    expect(screen.queryByText('success: recovered')).not.toBeInTheDocument();

    rerender(<LogView search="" records={records} />);

    await waitFor(() => expect(screen.getByText('success: recovered')).toBeInTheDocument());
  });

  test('searches marker labels and drops groups without matching descendants', () => {
    render(
      <LogView
        search="missing"
        records={[
          groupStart('build', 'Build'),
          output('build succeeded\n'),
          groupEnd('build'),
          groupStart('deploy', 'Deploy'),
          output('deploy started\n'),
          groupEnd('deploy'),
          {v: 1, ts, type: 'gap', droppedBytes: 64},
        ]}
      />,
    );

    expect(screen.getByText('Output missing')).toBeInTheDocument();
    expect(screen.queryByText('Build')).not.toBeInTheDocument();
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument();
  });

  test('shows a message when the log search has no matches', () => {
    render(<LogView search="missing" records={[output('hello\n')]} />);

    expect(screen.getByRole('status')).toHaveTextContent('No log lines match “missing”.');
    expect(screen.queryByText('hello')).toBeNull();
  });

  test('allows terminal logs to opt out of live announcements', () => {
    render(<LogView records={[output('hello\n')]} ariaLive="off" />);

    expect(screen.getByRole('log')).toHaveAttribute('aria-live', 'off');
  });

  test('renders assistant session text and collapsed thinking', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'message',
            timestamp: ts,
            role: 'assistant',
            label: 'assistant',
            meta: [],
            text: 'I will inspect the failure.',
            terminalFailure: false,
          }),
          agentSession({
            kind: 'thinking',
            timestamp: ts,
            text: 'The stack trace points at validation.',
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

  test('restores agent session line numbers when the gutter is re-enabled', () => {
    const records = [
      agentSession({
        kind: 'message',
        timestamp: ts,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'I will inspect the failure.',
        terminalFailure: false,
      }),
    ];
    const {container, rerender} = render(<LogView records={records} />);
    const gutter = () => container.querySelector('[data-slot="log-row-gutter"]');

    expect(gutter()).toHaveTextContent('1');

    rerender(<LogView records={records} showLineNumbers={false} />);

    expect(gutter()).toBeNull();

    rerender(<LogView records={records} showLineNumbers />);

    expect(gutter()).toHaveTextContent('1');
  });

  test('shows a completed action at its request position when the result arrives later', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'call-1',
            name: 'edit_file',
            input: '{}',
          }),
          output('stdout between call and result\n'),
          agentSession({
            kind: 'tool-result',
            timestamp: ts + 1,
            toolCallId: 'call-1',
            toolName: 'tool',
            output: 'patched',
            isError: false,
          }),
        ]}
      />,
    );

    expect(screen.getByText('Edit File')).toBeInTheDocument();
    expect(screen.getByText('stdout between call and result')).toBeDefined();
    expect(screen.getByText('succeeded')).toHaveClass('sr-only');
    expect(screen.getByText('1ms').parentElement).toHaveClass('text-foreground-contrast-secondary');
    expect(screen.queryByText('result edit_file')).not.toBeInTheDocument();
  });

  test('keeps a result without a matching request as a standalone action', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-result',
            timestamp: ts,
            toolCallId: 'missing-call',
            toolName: 'tool',
            output: 'result arrived without its call',
            isError: false,
          }),
        ]}
      />,
    );

    expect(screen.getByText('Tool')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toHaveClass('sr-only');

    fireEvent.click(screen.getByRole('button', {name: TOOL_BUTTON_NAME}));

    expect(screen.getByText('result arrived without its call')).toBeInTheDocument();
    expect(screen.getByText('Result')).toHaveClass('sr-only');
  });

  test('shows a running action when a tool call has no result yet', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'call-1',
            name: 'edit_file',
            input: '{}',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Edit File')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  test('keeps tool relationships when search matches only one side', () => {
    const records = [
      agentSession({
        kind: 'tool-call',
        timestamp: ts,
        id: 'call-1',
        name: 'edit_file',
        input: '{}',
      }),
      agentSession({
        kind: 'tool-result',
        timestamp: ts + 1,
        toolCallId: 'call-1',
        toolName: 'edit_file',
        output: 'patched',
        isError: false,
      }),
    ];

    const {unmount} = render(<LogView search="{}" records={records} />);
    expect(screen.getByText('Edit File')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();

    unmount();
    render(<LogView search="patched" records={records} />);
    expect(screen.getByText('Edit File')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    expect(screen.queryByText('result edit_file')).not.toBeInTheDocument();
  });

  test('renders paired Activity actions and result-only search matches', () => {
    const records = [
      agentSession({
        kind: 'tool-call',
        timestamp: ts,
        id: 'call-1',
        name: 'read_file',
        input: '{"path":"README.md"}',
      }),
      agentSession({
        kind: 'tool-result',
        timestamp: ts + 25,
        toolCallId: 'call-1',
        toolName: 'tool',
        output: 'README result',
        isError: false,
      }),
    ];

    render(<LogView search="README result" records={records} />);

    expect(screen.getByText('Read File')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    expect(screen.queryByText('tool read_file')).not.toBeInTheDocument();
    expect(screen.queryByText('result read_file')).not.toBeInTheDocument();
  });

  test('renders native command output and exit status without raw payloads', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'shell',
            name: 'Bash',
            input: '{"command":"pnpm test"}',
          }),
          agentSession({
            kind: 'tool-result',
            timestamp: ts + 1,
            toolCallId: 'shell',
            toolName: 'tool',
            output: 'Exit code: 1\nOutput:\nFAIL tests',
            isError: false,
          }),
        ]}
      />,
    );

    expect(screen.getByText('Run Command')).toBeInTheDocument();
    expect(screen.getByText('pnpm test')).toBeInTheDocument();
    expect(screen.getByText('failed')).toHaveClass('sr-only');
    const exitCode = screen.getByText('exit 1');
    expect(exitCode).not.toHaveClass('bg-background-contrast-base');
    expect(exitCode.parentElement).toHaveClass('gap-inline', 'text-tag-error-icon');
    expect(exitCode.nextElementSibling).toHaveClass('border-l');
    expect(exitCode.nextElementSibling?.nextElementSibling).toHaveTextContent('1ms');
    fireEvent.click(screen.getByRole('button', {name: RUN_COMMAND_BUTTON_NAME}));
    const output = screen.getByText('FAIL tests');
    expect(output.parentElement).toHaveClass('bg-background-contrast-base');
    expect(screen.getByText('Output')).toHaveClass('sr-only');
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
    expect(screen.queryByText('{"command":"pnpm test"}')).not.toBeInTheDocument();
  });

  test('shows only a native edit path and status', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'edit',
            name: 'Edit',
            input: '{"file_path":"src/a.ts","old_string":"before","new_string":"after"}',
          }),
          agentSession({
            kind: 'tool-result',
            timestamp: ts + 1,
            toolCallId: 'edit',
            toolName: 'tool',
            output: 'Edited src/a.ts',
            isError: false,
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: EDIT_FILE_BUTTON_NAME}));
    expect(screen.getAllByText('src/a.ts')).toHaveLength(2);
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
    expect(screen.queryByText('Edited src/a.ts')).not.toBeInTheDocument();
    expect(screen.queryByText('before')).not.toBeInTheDocument();
  });

  test('keeps a large native result bounded until requested', () => {
    const result = 'A'.repeat(6000);
    render(
      <LogView
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'read',
            name: 'Read',
            input: '{"file_path":"src/a.ts"}',
          }),
          agentSession({
            kind: 'tool-result',
            timestamp: ts + 1,
            toolCallId: 'read',
            toolName: 'tool',
            output: result,
            isError: false,
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: READ_FILE_BUTTON_NAME}));
    expect(screen.getByRole('button', {name: 'Show full result'})).toBeInTheDocument();
    expect(screen.queryByText(result)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Show full result'}));
    expect(screen.getByText(result)).toBeInTheDocument();
  });

  test('shows no result instead of a spinner after a terminal attempt', () => {
    render(
      <LogView
        attemptStatus="failed"
        records={[
          agentSession({
            kind: 'tool-call',
            timestamp: ts,
            id: 'call-1',
            name: 'run_command',
            input: 'pnpm test',
          }),
        ]}
      />,
    );

    expect(screen.getByText('no result')).toBeInTheDocument();
    expect(screen.getByText('no result').parentElement).toHaveClass(
      'text-foreground-contrast-secondary',
    );
    expect(screen.queryByText('running')).not.toBeInTheDocument();
  });

  test('renders message Markdown and hides empty thinking', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'message',
            timestamp: ts,
            role: 'assistant',
            label: 'assistant',
            meta: [],
            text: '**done**',
            terminalFailure: false,
          }),
          agentSession({kind: 'thinking', timestamp: ts + 1, text: '   '}),
        ]}
      />,
    );

    expect(screen.getByText('done').tagName).toBe('STRONG');
    expect(screen.queryByRole('button', {name: THINKING_BUTTON_NAME})).not.toBeInTheDocument();
  });

  test('renders unknown session entries without crashing', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'raw',
            timestamp: ts,
            label: 'Unknown session entry: future_entry',
            raw: '{"type":"future_entry","payload":{"value":true}}',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Unknown session entry: future_entry')).toBeDefined();
  });

  test('truncates large payloads with a show-more control', () => {
    render(
      <LogView
        records={[
          agentSession({
            kind: 'message',
            timestamp: ts,
            role: 'assistant',
            label: 'assistant',
            meta: [],
            text: 'x'.repeat(1500),
            terminalFailure: false,
          }),
        ]}
      />,
    );

    const toggle = screen.getByRole('button', {name: 'show more'});
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', {name: 'show less'}).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  test('anchors terminal failures once while search changes', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    scrollIntoViewWasStubbed = true;
    if (scrollIntoViewDescriptor == null) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: () => undefined,
      });
    }
    const scrollIntoView = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    const records = [
      output('setup\n'),
      agentSession({
        kind: 'message',
        timestamp: ts,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'I cannot continue.',
        terminalFailure: true,
      }),
    ];
    const {rerender} = render(<LogView anchorToFailure records={records} search="cannot" />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({block: 'center'}));
    scrollIntoView.mockClear();

    rerender(<LogView anchorToFailure records={records} search="missing" />);

    expect(scrollIntoView).not.toHaveBeenCalled();
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
