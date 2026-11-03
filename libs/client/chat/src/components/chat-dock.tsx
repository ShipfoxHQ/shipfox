import {isErrorWithCode} from '@shipfox/client-api';
import {type Project, useMaybeActiveProjectQuery} from '@shipfox/client-projects';
import {
  type AgentPageContext,
  ProjectDockPanel,
  useActiveWorkspace,
  useAuthState,
  useCurrentAgentPageContext,
  useProjectDock,
} from '@shipfox/client-shell/runtime';
import {QueryLoadError} from '@shipfox/client-ui';
import {type KeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState} from 'react';
import {
  CONTEXT_OVERFLOW_NOTICE_CODE,
  canSendAgain,
  isReplyActive,
  type TurnFailure,
  turnFailure,
} from '#core/turn-state.js';
import {type ChatConversation, useChatConversation} from '#hooks/api/chat-conversation.js';
import {
  CONVERSATION_TURN_RUNNING_CODE,
  isConversationNotFound,
  isMessageTooLong,
  useConversationListQuery,
  useDeleteConversationMutation,
} from '#hooks/api/conversations.js';
import {
  type ChatModelAvailability,
  useChatModelAvailability,
} from '#hooks/api/model-availability.js';
import {useAnnouncement} from '#hooks/use-announcement.js';
import {useDraft} from '#hooks/use-draft.js';
import {ChatHistory, conversationTitle} from './chat-history.js';
import {NoModelState, TurnFailureNotice, TurnNoticeCallout} from './chat-notices.js';
import {
  ChatPanelHeader,
  ChatPanelLayout,
  ConversationDeleted,
  FirstUse,
  PanelLoading,
} from './chat-panel.js';
import {ChatTranscript} from './chat-transcript.js';
import {pageContextLabel, suggestedPrompts} from './page-context.js';

const MESSAGE_TOO_LONG = 'This message is too long. Shorten it to send it.';

function deleteErrorCopy(error: unknown): string | undefined {
  if (!error) return undefined;
  return isErrorWithCode(error, CONVERSATION_TURN_RUNNING_CODE)
    ? 'Stop the reply before you delete this conversation.'
    : "Shippy couldn't delete this conversation. Try again.";
}
const SEND_FAILED = "Shippy didn't get this message. Try again.";

/** `Mod+.` opens or closes the panel from anywhere in the project. */
function useToggleShortcut(toggle: () => void) {
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== '.' || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);
}

/**
 * The `projectDock` contribution. It stays mounted while the panel is closed, so the shortcut
 * works and a conversation's state survives closing the panel and crossing the breakpoint.
 */
export default function ChatDock() {
  const {open, setOpen} = useProjectDock();
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  useToggleShortcut(toggle);
  const project = useMaybeActiveProjectQuery().data;
  if (!project) return null;
  return <ProjectChat key={project.id} project={project} />;
}

function composerError(draft: string, sendError: unknown): string | undefined {
  if (isMessageTooLong(draft)) return MESSAGE_TOO_LONG;
  return sendError && !isConversationNotFound(sendError) ? SEND_FAILED : undefined;
}

function panelTitle(params: {
  conversationId: string | undefined;
  title: string | null | undefined;
}): string {
  return params.conversationId ? conversationTitle({title: params.title ?? null}) : 'Shippy';
}

/** `Esc` stops a reply. Otherwise it closes the panel, when the composer is empty. */
function escapeHandler(params: {
  panelRef: RefObject<HTMLDivElement | null>;
  replying: boolean;
  draftEmpty: boolean;
  stop: () => void;
  close: () => void;
}) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // A modal renders through a portal, so its own Escape must not reach the panel.
    if (!(event.target instanceof Node) || !params.panelRef.current?.contains(event.target)) return;
    if (params.replying) {
      event.preventDefault();
      params.stop();
    } else if (params.draftEmpty) {
      event.preventDefault();
      params.close();
    }
  };
}

/** `undefined` follows the latest conversation. `null` is a new one, which the first message creates. */
type Selection = string | null | undefined;

function ProjectChat({project}: {project: Project}) {
  const {open, setOpen} = useProjectDock();
  const workspace = useActiveWorkspace();
  const userId = useAuthState().user?.id;
  const pageContext = useCurrentAgentPageContext();
  const [selection, setSelection] = useState<Selection>(undefined);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const listQuery = useConversationListQuery(project.id);
  const conversations = listQuery.data?.pages.flatMap((page) => page.conversations) ?? [];
  const conversationId = selection === undefined ? conversations[0]?.id : (selection ?? undefined);
  const resolving = selection === undefined && listQuery.isPending;

  const chat = useChatConversation({
    projectId: project.id,
    conversationId,
    active: open,
    onCreated: setSelection,
  });
  const models = useChatModelAvailability(workspace.id);
  const deleteMutation = useDeleteConversationMutation(project.id);
  const draft = useDraft({userId, projectId: project.id, conversationId});

  const replying = isReplyActive(chat.activity);
  const failure =
    chat.turn?.status === 'failed' && !replying ? turnFailure(chat.turn.failureCode) : undefined;
  const blocked = chat.notFound || failure?.kind === 'too-long' || !models.hasModel;
  const announcement = useAnnouncement({
    replying,
    transcript: chat.transcript,
    failureTitle: failure?.title,
  });

  const startNewConversation = useCallback(() => {
    // A deleted conversation's draft carries over, so nothing the user typed is lost.
    if (chat.notFound) draft.moveTo(undefined);
    setSelection(null);
    setView('chat');
    composerRef.current?.focus();
  }, [chat.notFound, draft]);

  const send = useCallback(
    async (text: string) => {
      // Taken before the send, because creating a conversation moves the composer to its draft.
      const sent = draft.take();
      try {
        await chat.send(text, pageContext);
      } catch {
        // The composer reports the failure, and the text comes back to edit.
        draft.setValue(sent);
      }
    },
    [chat, pageContext, draft],
  );

  // Opening moves focus to the composer. The shell returns it to the launcher on close.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const onKeyDown = escapeHandler({
    panelRef,
    replying: chat.turn?.status === 'running',
    draftEmpty: !draft.value.trim(),
    stop: () => void chat.stop(),
    close: () => setOpen(false),
  });

  const sendError = composerError(draft.value, chat.sendError);
  const title = panelTitle({
    conversationId,
    title: chat.detail?.title ?? conversations.find((c) => c.id === conversationId)?.title,
  });

  return (
    <ProjectDockPanel label="Shippy">
      <ChatPanelLayout
        panelRef={panelRef}
        onKeyDown={onKeyDown}
        announcement={announcement}
        header={
          <ChatPanelHeader
            title={title}
            view={view}
            onToggleHistory={() =>
              setView((current) => (current === 'history' ? 'chat' : 'history'))
            }
            onNewConversation={startNewConversation}
            onClose={() => setOpen(false)}
          />
        }
        body={
          view === 'history' ? (
            <ChatHistory
              conversations={conversations}
              loading={listQuery.isPending}
              selectedId={conversationId}
              replyingId={replying ? conversationId : undefined}
              hasMore={listQuery.hasNextPage}
              loadingMore={listQuery.isFetchingNextPage}
              onLoadMore={() => void listQuery.fetchNextPage()}
              onSelect={(id) => {
                setSelection(id);
                setView('chat');
                composerRef.current?.focus();
              }}
              onDelete={async (id) => {
                try {
                  await deleteMutation.mutateAsync(id);
                } catch {
                  return false;
                }
                if (id === conversationId) setSelection(null);
                return true;
              }}
              deleting={deleteMutation.isPending}
              deleteError={deleteErrorCopy(deleteMutation.error)}
              onDeleteDismissed={deleteMutation.reset}
            />
          ) : (
            <ConversationBody
              chat={chat}
              models={models}
              failure={failure}
              resolving={resolving}
              workspaceSlug={workspace.slug}
              pageContext={pageContext}
              onNewConversation={startNewConversation}
            />
          )
        }
        composer={
          view === 'chat' && models.hasModel
            ? {
                ref: composerRef,
                value: draft.value,
                onValueChange: draft.setValue,
                onBlur: draft.save,
                onSubmit: send,
                contextLabel: pageContextLabel(pageContext),
                replying: chat.turn?.status === 'running',
                stopping: chat.activity.kind === 'stopping',
                onStop: () => void chat.stop(),
                disabled: blocked || resolving,
                error: sendError,
                submitBlocked: isMessageTooLong(draft.value),
              }
            : undefined
        }
      />
    </ProjectDockPanel>
  );
}

function ConversationBody({
  chat,
  models,
  failure,
  resolving,
  workspaceSlug,
  pageContext,
  onNewConversation,
}: {
  chat: ChatConversation;
  models: ChatModelAvailability;
  failure: TurnFailure | undefined;
  resolving: boolean;
  workspaceSlug: string;
  pageContext: AgentPageContext | undefined;
  onNewConversation: () => void;
}) {
  const replying = isReplyActive(chat.activity);
  if (!models.hasModel) return <NoModelState workspaceSlug={workspaceSlug} />;
  if (resolving || chat.loading) return <PanelLoading />;
  if (chat.notFound) return <ConversationDeleted onNewConversation={onNewConversation} />;
  if (chat.loadError) return <QueryLoadError query={chat.loadError} subject="conversation" />;
  if (chat.transcript.length === 0 && !replying) {
    return (
      <FirstUse
        prompts={suggestedPrompts(pageContext)}
        onPrompt={(prompt) => void chat.send(prompt, pageContext).catch(() => undefined)}
      />
    );
  }

  const lastEntry = chat.transcript.at(-1);
  return (
    <ChatTranscript
      entries={chat.transcript}
      activity={chat.activity}
      olderHistory={chat.olderHistory}
      renderNotice={(entry) => (
        <TurnNoticeCallout
          notice={entry.notice}
          busy={chat.retrying}
          onSendAgain={
            entry === lastEntry && !replying && canSendAgain(entry.notice.code)
              ? () => void chat.retry()
              : undefined
          }
          onNewConversation={
            entry === lastEntry && entry.notice.code === CONTEXT_OVERFLOW_NOTICE_CODE
              ? onNewConversation
              : undefined
          }
        />
      )}
      footer={
        failure && lastEntry?.kind !== 'notice' ? (
          <TurnFailureNotice
            failure={failure}
            model={models.unavailableModel({
              provider: chat.turn?.provider ?? null,
              model: chat.turn?.model ?? null,
            })}
            workspaceSlug={workspaceSlug}
            busy={chat.retrying}
            onRetry={() => void chat.retry()}
            onNewConversation={onNewConversation}
          />
        ) : undefined
      }
    />
  );
}
