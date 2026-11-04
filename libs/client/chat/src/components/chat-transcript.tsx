import {Badge} from '@shipfox/react-ui/badge';
import {Bubble} from '@shipfox/react-ui/bubble';
import {Button} from '@shipfox/react-ui/button';
import {Markdown} from '@shipfox/react-ui/markdown';
import {Message, MessageFooter} from '@shipfox/react-ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScrollerScrollable,
} from '@shipfox/react-ui/message-scroller';
import {type ReactNode, useEffect} from 'react';
import type {TranscriptEntry} from '#core/transcript.js';
import type {ReplyActivity} from '#core/turn-state.js';
import {useInAppLinks} from '#hooks/use-in-app-links.js';
import {ChatRunCard} from './chat-runs.js';
import {ChatRunStarted, ChatToolRows} from './chat-tool-rows.js';

const activityCopy: Partial<Record<ReplyActivity['kind'], string>> = {
  thinking: 'Thinking',
  'slow-start': 'Taking longer than usual to start.',
  stopping: 'Stopping',
  reconnecting: 'Reconnecting',
};

function EntryView({
  entry,
  workspaceSlug,
  projectSlug,
}: {
  entry: TranscriptEntry;
  workspaceSlug: string;
  projectSlug: string;
}) {
  switch (entry.kind) {
    case 'user':
      return (
        <Message align="end">
          <Bubble>{entry.text}</Bubble>
          {entry.queued ? (
            <MessageFooter>
              <Badge variant="neutral" size="2xs">
                Queued
              </Badge>
            </MessageFooter>
          ) : null}
        </Message>
      );
    case 'agent':
      return (
        <Message align="start">
          {entry.text ? (
            <Bubble variant="muted">
              <Markdown>{entry.text}</Markdown>
            </Bubble>
          ) : null}
          {entry.stopped ? <MessageFooter>Stopped</MessageFooter> : null}
        </Message>
      );
    case 'tools':
      return <ChatToolRows nodes={entry.nodes} />;
    case 'run-started':
      return (
        <ChatRunStarted run={entry.run} workspaceSlug={workspaceSlug} projectSlug={projectSlug} />
      );
    case 'run-result':
      return (
        <ChatRunCard
          result={entry.result}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
        />
      );
    case 'notice':
      return null;
  }
}

/** Reports whether the reader can see the latest message, which is what marks it read. */
function LatestVisibility({onChange}: {onChange: (visible: boolean) => void}) {
  const {end} = useMessageScrollerScrollable();
  const visible = !end;
  useEffect(() => onChange(visible), [onChange, visible]);
  // A transcript that leaves the panel shows nothing, so nothing in it can be read.
  useEffect(() => () => onChange(false), [onChange]);
  return null;
}

export interface ChatTranscriptProps {
  entries: readonly TranscriptEntry[];
  workspaceSlug: string;
  projectSlug: string;
  activity: ReplyActivity;
  /** Renders a notice entry, which needs the panel's actions. */
  renderNotice: (entry: Extract<TranscriptEntry, {kind: 'notice'}>) => ReactNode;
  /** The failed turn's notice, after everything else. */
  footer?: ReactNode;
  olderHistory: {hasMore: boolean; loading: boolean; load: () => void};
  /** Called with whether the latest message is scrolled into view. */
  onLatestVisibleChange?: ((visible: boolean) => void) | undefined;
}

export function ChatTranscript({
  entries,
  workspaceSlug,
  projectSlug,
  activity,
  renderNotice,
  footer,
  olderHistory,
  onLatestVisibleChange,
}: ChatTranscriptProps) {
  const onClick = useInAppLinks();
  const status = activityCopy[activity.kind];

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      {onLatestVisibleChange ? <LatestVisibility onChange={onLatestVisibleChange} /> : null}
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Conversation with Shippy">
          <MessageScrollerContent
            aria-label="Messages"
            aria-busy={activity.kind !== 'idle'}
            onClick={onClick}
          >
            {olderHistory.hasMore ? (
              <MessageScrollerItem className="flex justify-center">
                <Button
                  variant="transparent"
                  size="xs"
                  isLoading={olderHistory.loading}
                  onClick={olderHistory.load}
                >
                  Show earlier messages
                </Button>
              </MessageScrollerItem>
            ) : null}
            {entries.map((entry) => (
              <MessageScrollerItem
                key={entry.key}
                messageId={entry.key}
                scrollAnchor={entry.kind === 'user'}
              >
                {entry.kind === 'notice' ? (
                  renderNotice(entry)
                ) : (
                  <EntryView
                    entry={entry}
                    workspaceSlug={workspaceSlug}
                    projectSlug={projectSlug}
                  />
                )}
              </MessageScrollerItem>
            ))}
            {status ? (
              <MessageScrollerItem messageId="activity">
                <p className="px-tight text-xs text-foreground-neutral-muted">{status}</p>
              </MessageScrollerItem>
            ) : null}
            {footer ? <MessageScrollerItem messageId="footer">{footer}</MessageScrollerItem> : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
