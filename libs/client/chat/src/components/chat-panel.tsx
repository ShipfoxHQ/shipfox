import {Shippy} from '@shipfox/client-shell/runtime';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout, CalloutActions, CalloutContent, CalloutTitle} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Suggestion, Suggestions} from '@shipfox/react-ui/suggestion';
import type {KeyboardEvent, ReactNode, Ref} from 'react';
import {ChatComposer, type ChatComposerProps} from './chat-composer.js';

export interface ChatPanelHeaderProps {
  title: string;
  view: 'chat' | 'history';
  onToggleHistory: () => void;
  onNewConversation: () => void;
  onClose: () => void;
}

export function ChatPanelHeader({
  title,
  view,
  onToggleHistory,
  onNewConversation,
  onClose,
}: ChatPanelHeaderProps) {
  return (
    <header className="flex h-40 shrink-0 items-center gap-inline border-b border-border-neutral-base px-tight">
      {/* Mirrored, so Shippy faces the title. */}
      <Shippy pose="face" className="h-24 -scale-x-100" />
      <h2 className="min-w-0 flex-1 truncate font-display text-sm font-medium text-foreground-neutral-base">
        {view === 'history' ? 'Conversations' : title}
      </h2>
      <IconButton
        variant="transparent"
        size="xs"
        icon="historyLine"
        aria-label={view === 'history' ? 'Back to the conversation' : 'Show conversations'}
        aria-pressed={view === 'history'}
        onClick={onToggleHistory}
      />
      <IconButton
        variant="transparent"
        size="xs"
        icon="chatNewLine"
        aria-label="New conversation"
        onClick={onNewConversation}
      />
      <IconButton
        variant="transparent"
        size="xs"
        icon="closeLine"
        aria-label="Close Shippy"
        onClick={onClose}
      />
    </header>
  );
}

export interface FirstUseProps {
  prompts: readonly string[];
  onPrompt: (prompt: string) => void;
}

/** Says what Shippy can and can't do. Prompts for the current page don't send until clicked. */
export function FirstUse({prompts, onPrompt}: FirstUseProps) {
  return (
    <div className="flex flex-1 flex-col justify-end gap-group overflow-y-auto p-tight">
      <EmptyState
        illustration={<Shippy pose="bench" className="h-96" />}
        title="Shippy, your project agent"
        description="Shippy reads this project's runs, logs, and workflows, and explains what failed. It can't start work yet."
      />
      {prompts.length > 0 ? (
        <Suggestions role="group" aria-label="Suggested questions">
          {prompts.map((prompt) => (
            <Suggestion key={prompt} suggestion={prompt} onClick={onPrompt} />
          ))}
        </Suggestions>
      ) : null}
    </div>
  );
}

export function ConversationDeleted({onNewConversation}: {onNewConversation: () => void}) {
  return (
    <div className="flex flex-1 flex-col justify-end p-tight">
      <Callout type="warning">
        <CalloutContent className="flex flex-col gap-inline">
          <CalloutTitle className="mb-0">This conversation was deleted.</CalloutTitle>
          <CalloutActions>
            <Button size="2xs" variant="secondary" onClick={onNewConversation}>
              New conversation
            </Button>
          </CalloutActions>
        </CalloutContent>
      </Callout>
    </div>
  );
}

export function PanelLoading() {
  return <FullPageLoader className="h-auto flex-1" />;
}

export interface ChatPanelLayoutProps {
  header: ReactNode;
  body: ReactNode;
  composer: (ChatComposerProps & {ref: Ref<HTMLTextAreaElement>}) | undefined;
  /** One polite region for the reply's start, its end, and failures. */
  announcement: string;
  panelRef: Ref<HTMLDivElement>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function ChatPanelLayout({
  header,
  body,
  composer,
  announcement,
  panelRef,
  onKeyDown,
}: ChatPanelLayoutProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc stops a reply or closes the panel from any control inside it.
    <div ref={panelRef} className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      {header}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      {composer ? <ChatComposer {...composer} /> : null}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
