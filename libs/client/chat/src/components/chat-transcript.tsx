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
} from '@shipfox/react-ui/message-scroller';
import {useRouter} from '@tanstack/react-router';
import type {MouseEvent, ReactNode} from 'react';
import type {TranscriptEntry} from '#core/transcript.js';
import type {ReplyActivity} from '#core/turn-state.js';
import {ChatToolRows} from './chat-tool-rows.js';

const activityCopy: Partial<Record<ReplyActivity['kind'], string>> = {
  thinking: 'Thinking',
  'slow-start': 'Taking longer than usual to start.',
  stopping: 'Stopping',
  reconnecting: 'Reconnecting',
};

function sameOriginPath(anchor: HTMLAnchorElement): string | undefined {
  try {
    const url = new URL(anchor.href);
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : undefined;
  } catch {
    return undefined;
  }
}

/** A link to a Shipfox page moves the page, and the panel stays. */
function useInAppLinks() {
  const router = useRouter();
  return (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    const path = sameOriginPath(anchor);
    if (!path) return;
    event.preventDefault();
    void router.navigate({href: path});
  };
}

function EntryView({entry}: {entry: TranscriptEntry}) {
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
    case 'notice':
      return null;
  }
}

export interface ChatTranscriptProps {
  entries: readonly TranscriptEntry[];
  activity: ReplyActivity;
  /** Renders a notice entry, which needs the panel's actions. */
  renderNotice: (entry: Extract<TranscriptEntry, {kind: 'notice'}>) => ReactNode;
  /** The failed turn's notice, after everything else. */
  footer?: ReactNode;
  olderHistory: {hasMore: boolean; loading: boolean; load: () => void};
}

export function ChatTranscript({
  entries,
  activity,
  renderNotice,
  footer,
  olderHistory,
}: ChatTranscriptProps) {
  const onClick = useInAppLinks();
  const status = activityCopy[activity.kind];

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
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
                {entry.kind === 'notice' ? renderNotice(entry) : <EntryView entry={entry} />}
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
