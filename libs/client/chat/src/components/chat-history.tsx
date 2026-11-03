import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Dot} from '@shipfox/react-ui/dot';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {PanelRow} from '@shipfox/react-ui/panel';
import {RelativeTime, RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import type {ConversationSummary} from '#core/conversation.js';

export function conversationTitle(conversation: Pick<ConversationSummary, 'title'>): string {
  return conversation.title?.trim() || 'Untitled conversation';
}

export interface ChatHistoryProps {
  conversations: readonly ConversationSummary[];
  loading: boolean;
  selectedId: string | undefined;
  /** The conversation whose reply is running. It can't be deleted until the reply stops. */
  replyingId: string | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (conversationId: string) => void;
  /** Resolves false when the delete was refused, so the modal stays open with the reason. */
  onDelete: (conversationId: string) => Promise<boolean>;
  deleteError: string | undefined;
  deleting: boolean;
}

export function ChatHistory({
  conversations,
  loading,
  selectedId,
  replyingId,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
  onDelete,
  deleteError,
  deleting,
}: ChatHistoryProps) {
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | undefined>(undefined);

  if (loading) {
    return <FullPageLoader className="h-auto flex-1" />;
  }
  if (conversations.length === 0) {
    return (
      <EmptyState
        icon="chat3Line"
        title="No conversations yet"
        description="Your conversations with Shippy in this project show here. Only you can see them."
      />
    );
  }

  return (
    <RelativeTimeProvider>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ul aria-label="Conversations" className="flex flex-col">
          {conversations.map((conversation) => {
            const title = conversationTitle(conversation);
            const replying = conversation.id === replyingId;
            return (
              <PanelRow key={conversation.id} asChild className="gap-inline py-0">
                <li aria-current={conversation.id === selectedId ? 'true' : undefined}>
                  <button
                    type="button"
                    className="flex min-h-44 min-w-0 flex-1 cursor-pointer items-center gap-inline text-left outline-none focus-visible:shadow-focus-inset"
                    onClick={() => onSelect(conversation.id)}
                  >
                    {conversation.unread ? <Dot variant="info" /> : null}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {title}
                      {conversation.unread ? <span className="sr-only">, unread reply</span> : null}
                    </span>
                    <RelativeTime
                      value={conversation.lastActivityAt}
                      className="shrink-0 text-xs text-foreground-neutral-muted"
                    />
                  </button>
                  <IconButton
                    variant="transparent"
                    size="xs"
                    icon="deleteBinLine"
                    aria-label={`Delete ${title}`}
                    disabled={replying}
                    title={replying ? 'Stop the reply to delete this conversation' : undefined}
                    onClick={() => setPendingDelete(conversation)}
                  />
                </li>
              </PanelRow>
            );
          })}
        </ul>
        {hasMore ? (
          <div className="flex justify-center p-tight">
            <Button variant="transparent" size="xs" isLoading={loadingMore} onClick={onLoadMore}>
              Show older conversations
            </Button>
          </div>
        ) : null}
      </div>
      <Modal
        open={pendingDelete !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete this conversation?</ModalTitle>
          </ModalHeader>
          <ModalBody className="gap-group">
            <Text size="sm">
              This deletes the history for you. Its runs keep going, and their results won't reach
              this chat.
            </Text>
            {deleteError ? (
              <Callout role="alert" type="error">
                <Text size="sm">{deleteError}</Text>
              </Callout>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setPendingDelete(undefined)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={deleting}
              onClick={async () => {
                if (!pendingDelete) return;
                if (await onDelete(pendingDelete.id)) setPendingDelete(undefined);
              }}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </RelativeTimeProvider>
  );
}
