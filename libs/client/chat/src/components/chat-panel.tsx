import {Shippy} from '@shipfox/client-shell/runtime';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout, CalloutActions, CalloutContent, CalloutTitle} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Label} from '@shipfox/react-ui/label';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipfox/react-ui/select';
import {Suggestion, Suggestions} from '@shipfox/react-ui/suggestion';
import {type KeyboardEvent, type ReactNode, type Ref, useId} from 'react';
import {agentLabel, type ProjectAgent, SHIPPY_AGENT_KEY} from '#core/project-agents.js';
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

export interface AgentPickerProps {
  agents: readonly ProjectAgent[];
  value: string;
  onChange: (key: string) => void;
}

/** Picks the agent a new conversation talks to. The agent is fixed once the first message is sent. */
export function AgentPicker({agents, value, onChange}: AgentPickerProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-inline">
      <Label htmlFor={id}>Agent</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="small" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {agents.map((agent) => (
            <SelectItem key={agent.key} value={agent.key}>
              {agentLabel(agent)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export interface FirstUseProps {
  prompts: readonly string[];
  onPrompt: (prompt: string) => void;
  /** The agent the conversation will talk to. A custom agent is introduced by its own name and description. */
  agent?: ProjectAgent | undefined;
  /** Set when the project has custom agents. */
  picker?: ReactNode;
}

/** Says what Shippy can and can't do. Prompts for the current page don't send until clicked. */
export function FirstUse({prompts, onPrompt, agent, picker}: FirstUseProps) {
  const custom = agent !== undefined && agent.key !== SHIPPY_AGENT_KEY;
  return (
    <div className="flex flex-1 flex-col justify-end gap-group overflow-y-auto p-tight">
      <EmptyState
        illustration={<Shippy pose="bench" className="h-96" />}
        title={custom ? agentLabel(agent) : 'Shippy, your project agent'}
        description={
          custom
            ? (agent.description ?? 'A custom agent of this project.')
            : "Shippy reads this project's runs, logs, and workflows, and explains what failed. Ask it to start a workflow, and it asks before it does any work."
        }
      />
      {picker}
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

/** The latest sync rejected the agent's file. The agent keeps running its last valid version. */
export function AgentFileError({agent}: {agent: ProjectAgent}) {
  return (
    <div className="shrink-0 p-tight pb-0">
      <Callout type="warning">
        <CalloutContent className="flex flex-col gap-inline">
          <CalloutTitle className="mb-0">
            {`${agentLabel(agent)} uses its last valid configuration.`}
          </CalloutTitle>
          <p className="break-words">{`Its agent file is invalid: ${agent.error}`}</p>
        </CalloutContent>
      </Callout>
    </div>
  );
}

/** The agent's file was deleted. The conversation stays readable, and takes no new message. */
export function AgentUnavailable({onNewConversation}: {onNewConversation: () => void}) {
  return (
    <div className="shrink-0 p-tight pb-0">
      <Callout type="warning">
        <CalloutContent className="flex flex-col gap-inline">
          <CalloutTitle className="mb-0">This conversation's agent was deleted.</CalloutTitle>
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

/** What the panel says about the conversation's agent, if anything. */
export function AgentNotice({
  agent,
  gone,
  onNewConversation,
}: {
  agent: ProjectAgent | undefined;
  gone: boolean;
  onNewConversation: () => void;
}) {
  if (gone) return <AgentUnavailable onNewConversation={onNewConversation} />;
  if (agent?.error) return <AgentFileError agent={agent} />;
  return null;
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
