import type {Meta, StoryObj} from '@storybook/react';
import {type ReactNode, useState} from 'react';
import {expect, fireEvent, userEvent, waitFor, within} from 'storybook/test';
import {Bubble} from '#components/bubble/index.js';
import {Button} from '#components/button/index.js';
import {Markdown} from '#components/markdown/index.js';
import {Message} from '#components/message/index.js';
import {
  PromptInput,
  PromptInputContextChip,
  PromptInputField,
  PromptInputFooter,
  PromptInputStop,
  PromptInputSubmit,
  PromptInputTextarea,
} from '#components/prompt-input/index.js';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceDetail,
  TraceLine,
  TraceTitle,
} from '#components/trace/index.js';
import {Code} from '#components/typography/index.js';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './message-scroller.js';

type Row =
  | {id: string; kind: 'user' | 'agent'; text: string}
  | {id: string; kind: 'tools'; calls: ToolCall[]};

interface ToolCall {
  title: string;
  target: string;
  detail?: string;
}

const failureReply = `**The tests couldn't reach Postgres.** All 6 failures in \`settlement.test.ts\` are ECONNREFUSED on port 5432, so this is the setup, not your rounding change.

\`integration-tests\` has no database service. \`build\` dropped it in commit \`a91f3c2\`.

The fix is to add a \`postgres\` service to the job or to start it in a setup step.`;

const logExcerpt = `416 > ledger/settlement.test.ts (6 failed)
418   Error: connect ECONNREFUSED 127.0.0.1:5432`;

const shortRows: Row[] = [
  {id: 'question', kind: 'user', text: 'Why did this fail?'},
  {id: 'answer', kind: 'agent', text: failureReply},
];

const history: Array<[string, string]> = [
  ['Why did this fail?', failureReply],
  [
    'Did the lint job fail too?',
    'No. `lint` passed in 40 s. Only `integration-tests` failed on run #214.',
  ],
  [
    'When did integration-tests last pass?',
    'Run #213 passed on `main` two hours ago. It still had the `postgres` service.',
  ],
  [
    'Which commit removed the service?',
    "`a91f3c2` on `fix/ledger-rounding`. Its message is `Simplify build`, and it deletes the job's `services` block.",
  ],
  [
    'Is anything else in that commit risky?',
    'It also drops the cache key for `node_modules`, so installs take about 30 s longer. Nothing else touches test setup.',
  ],
  [
    'Summarize this run',
    '`deploy-preview` #214 ran 4 jobs in 6m 12s. `install`, `build`, and `lint` passed. `integration-tests` failed with 6 connection errors.',
  ],
];

const longRows: Row[] = history.flatMap(([question, answer], index) => [
  {id: `question-${index}`, kind: 'user' as const, text: question},
  {id: `answer-${index}`, kind: 'agent' as const, text: answer},
]);

const streamingRows: Row[] = [
  {id: 'question', kind: 'user', text: 'Why did this fail?'},
  {
    id: 'reads',
    kind: 'tools',
    calls: [
      {title: 'Read run', target: 'deploy-preview #214'},
      {title: 'Read job', target: 'integration-tests'},
      {title: 'Read logs of', target: 'Run tests', detail: logExcerpt},
    ],
  },
  {
    id: 'answer',
    kind: 'agent',
    text: "**The tests couldn't reach Postgres.** All 6 failures in `settlement.test.ts` are ECONNREFUSED on port",
  },
];

const streamedLine = ' The job has no database service, so every connection is refused.';

const streamedParagraphs = Array.from(
  {length: 8},
  (_, index) =>
    `\n\nStep ${index + 1}: the runner starts the job without a \`postgres\` service, and each test that opens a connection fails on port 5432.`,
).join('');

function TranscriptRow({row}: {row: Row}) {
  if (row.kind === 'tools') {
    return (
      <MessageScrollerItem messageId={row.id}>
        <Trace>
          {row.calls.map((call) => (
            <TraceCollapsible key={call.title} defaultOpen={Boolean(call.detail)}>
              <TraceCollapsibleTrigger>
                <TraceLine status="succeeded">
                  <TraceTitle>{call.title}</TraceTitle>
                  <TraceDescription>{call.target}</TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
              {call.detail ? (
                <TraceCollapsibleContent>
                  <TraceDetail>{call.detail}</TraceDetail>
                </TraceCollapsibleContent>
              ) : null}
            </TraceCollapsible>
          ))}
        </Trace>
      </MessageScrollerItem>
    );
  }

  const isUser = row.kind === 'user';

  return (
    <MessageScrollerItem messageId={row.id} scrollAnchor={isUser}>
      <Message align={isUser ? 'end' : 'start'}>
        {isUser ? (
          <Bubble>{row.text}</Bubble>
        ) : (
          <Bubble variant="muted">
            <Markdown>{row.text}</Markdown>
          </Bubble>
        )}
      </Message>
    </MessageScrollerItem>
  );
}

interface TranscriptProps {
  rows: Row[];
  streaming?: boolean;
  defaultScrollPosition?: 'start' | 'end' | 'last-anchor';
}

function Transcript({rows, streaming = false, defaultScrollPosition}: TranscriptProps) {
  return (
    <MessageScrollerProvider defaultScrollPosition={defaultScrollPosition}>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent aria-busy={streaming}>
            {rows.map((row) => (
              <TranscriptRow key={row.id} row={row} />
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function Frame({children}: {children: ReactNode}) {
  return (
    <div className="flex h-480 w-400 flex-col overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
      {children}
    </div>
  );
}

function Labeled({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="grid gap-8">
      <Code variant="label" className="text-foreground-neutral-subtle">
        {label}
      </Code>
      {children}
    </div>
  );
}

function LiveTranscript() {
  const [rows, setRows] = useState<Row[]>(longRows);

  function send() {
    setRows((current) => [
      ...current,
      {id: 'sent', kind: 'user', text: 'Can you check the lint job too?'},
      {id: 'reply', kind: 'agent', text: 'Reading `lint` on run #214.'},
    ]);
  }

  function stream(text: string) {
    setRows((current) => {
      const lastAgentIndex = current.findLastIndex((row) => row.kind === 'agent');
      return current.map((row, index) =>
        index === lastAgentIndex && row.kind === 'agent' ? {...row, text: row.text + text} : row,
      );
    });
  }

  return (
    <div className="grid gap-12">
      <Frame>
        <Transcript rows={rows} streaming />
      </Frame>
      <div className="flex gap-8">
        <Button variant="secondary" size="sm" onClick={send}>
          Send
        </Button>
        <Button variant="secondary" size="sm" onClick={() => stream(streamedLine)}>
          Stream a line
        </Button>
        <Button variant="secondary" size="sm" onClick={() => stream(streamedParagraphs)}>
          Stream a long reply
        </Button>
      </div>
    </div>
  );
}

function getTranscript(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const viewport = canvas.getByRole('region', {name: 'Messages'});
  const jump = canvas.getByText('Jump to latest').closest('button');
  if (!jump) throw new Error('Jump to latest is missing');
  return {canvas, viewport, jump};
}

function distanceFromLatest(viewport: HTMLElement) {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

function offsetInViewport(element: Element, viewport: HTMLElement) {
  return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
}

async function scrollUpByHand(viewport: HTMLElement) {
  fireEvent.wheel(viewport, {deltaY: -300});
  viewport.scrollTop -= 300;
  await waitFor(() => expect(distanceFromLatest(viewport)).toBeGreaterThan(200));
}

const meta = {
  title: 'Components/MessageScroller',
  component: MessageScroller,
  tags: ['autodocs'],
} satisfies Meta<typeof MessageScroller>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <Frame>
      <Transcript rows={longRows} />
    </Frame>
  ),
};

export const Content: Story = {
  render: () => (
    <div className="flex flex-wrap gap-16">
      <Labeled label="short">
        <Frame>
          <Transcript rows={shortRows} />
        </Frame>
      </Labeled>
      <Labeled label="long">
        <Frame>
          <Transcript rows={longRows} />
        </Frame>
      </Labeled>
      <Labeled label="streaming">
        <Frame>
          <Transcript rows={streamingRows} streaming />
        </Frame>
      </Labeled>
    </div>
  ),
};

export const JumpToLatest: Story = {
  render: () => (
    <Frame>
      <Transcript rows={longRows} defaultScrollPosition="start" />
    </Frame>
  ),
};

function ChatPanel() {
  const [draft, setDraft] = useState('');

  return (
    <div className="flex h-620 w-400 flex-col overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <div className="min-h-0 flex-1">
        <Transcript rows={streamingRows} streaming />
      </div>
      <div className="p-12">
        <PromptInput value={draft} onValueChange={setDraft} onSubmit={() => setDraft('')}>
          <PromptInputContextChip>Viewing run #214</PromptInputContextChip>
          <PromptInputField>
            <PromptInputTextarea
              aria-label="Message Shippy"
              placeholder="Ask about this project's runs"
            />
            <PromptInputFooter>
              <PromptInputSubmit stop={<PromptInputStop />} />
            </PromptInputFooter>
          </PromptInputField>
        </PromptInput>
      </div>
    </div>
  );
}

export const Compositions: Story = {
  render: () => <ChatPanel />,
};

export const Streaming: Story = {
  render: () => <LiveTranscript />,
};

export const TestAnchorsSentMessage: Story = {
  render: () => <LiveTranscript />,
  play: async ({canvasElement}) => {
    const {canvas, viewport} = getTranscript(canvasElement);
    await waitFor(() => expect(distanceFromLatest(viewport)).toBeLessThan(8));

    await userEvent.click(canvas.getByRole('button', {name: 'Send'}));

    const sent = canvasElement.querySelector('[data-message-id="sent"]');
    if (!sent) throw new Error('The sent message is missing');
    await waitFor(() => {
      const top = offsetInViewport(sent, viewport);
      expect(top).toBeGreaterThan(0);
      expect(top).toBeLessThan(120);
    });
    const anchoredTop = offsetInViewport(sent, viewport);

    await userEvent.click(canvas.getByRole('button', {name: 'Stream a line'}));
    await userEvent.click(canvas.getByRole('button', {name: 'Stream a line'}));

    await waitFor(() =>
      expect(Math.abs(offsetInViewport(sent, viewport) - anchoredTop)).toBeLessThan(2),
    );
  },
};

export const TestFollowsLongReply: Story = {
  render: () => <LiveTranscript />,
  play: async ({canvasElement}) => {
    const {canvas, viewport, jump} = getTranscript(canvasElement);
    await userEvent.click(canvas.getByRole('button', {name: 'Send'}));

    await userEvent.click(canvas.getByRole('button', {name: 'Stream a long reply'}));

    await waitFor(() => expect(distanceFromLatest(viewport)).toBeLessThan(8));
    await waitFor(() => expect(jump).toHaveAttribute('data-active', 'false'));
  },
};

export const TestScrollingUpStopsFollowing: Story = {
  render: () => <LiveTranscript />,
  play: async ({canvasElement}) => {
    const {canvas, viewport, jump} = getTranscript(canvasElement);
    await waitFor(() => expect(distanceFromLatest(viewport)).toBeLessThan(8));

    await scrollUpByHand(viewport);
    await waitFor(() => expect(jump).toHaveAttribute('data-active', 'true'));
    // Rows above render lazily and the browser keeps them in place by adjusting scrollTop,
    // so this tracks what the reader sees instead.
    const reply = canvasElement.querySelector('[data-message-id="answer-5"]');
    if (!reply) throw new Error('The last reply is missing');
    const readingPosition = offsetInViewport(reply, viewport);
    await userEvent.click(canvas.getByRole('button', {name: 'Stream a line'}));

    await waitFor(() =>
      expect(Math.abs(offsetInViewport(reply, viewport) - readingPosition)).toBeLessThan(2),
    );
    await expect(distanceFromLatest(viewport)).toBeGreaterThan(200);

    await userEvent.click(jump);

    await waitFor(() => expect(distanceFromLatest(viewport)).toBeLessThan(8));
    await waitFor(() => expect(jump).toHaveAttribute('data-active', 'false'));
    await expect(document.activeElement).toBe(viewport);
  },
};

export const TestJumpSkipsSmoothScrollUnderReducedMotion: Story = {
  render: () => <LiveTranscript />,
  beforeEach: () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      media: query,
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as typeof window.matchMedia;
    return () => {
      window.matchMedia = originalMatchMedia;
    };
  },
  play: async ({canvasElement}) => {
    const {viewport, jump} = getTranscript(canvasElement);
    await waitFor(() => expect(distanceFromLatest(viewport)).toBeLessThan(8));
    await scrollUpByHand(viewport);
    await waitFor(() => expect(jump).toHaveAttribute('data-active', 'true'));

    await userEvent.click(jump);

    await expect(distanceFromLatest(viewport)).toBeLessThan(8);
  },
};
