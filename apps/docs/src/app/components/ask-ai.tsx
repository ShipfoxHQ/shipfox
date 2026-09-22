'use client';

import {type UseChatHelpers, useChat} from '@ai-sdk/react';
import {DefaultChatTransport} from 'ai';
import clsx from 'clsx';
import {DynamicCodeBlock} from 'fumadocs-ui/components/dynamic-codeblock';
import {buttonVariants} from 'fumadocs-ui/components/ui/button';
import {FileTextIcon, Loader2, MessageCircleIcon, RotateCcw, SendIcon, XIcon} from 'lucide-react';
import {
  type ComponentProps,
  createContext,
  isValidElement,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import Markdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  askAiAnswerProperties,
  askAiFailureReason,
  askAiQuestionProperties,
} from '@/lib/ask-ai-analytics';
import {
  type AskAiMessage,
  askAiAnswerMetadataSchema,
  codeLanguage,
  resolveCitationLink,
} from '@/lib/ask-ai-core';
import {captureDocsEvent} from '@/lib/docs-analytics';
import {sanitizeTrackedUrl} from '@/lib/docs-analytics-core';
import {basePath} from '@/url';

interface AskAiState {
  open: boolean;
  setOpen: (open: boolean) => void;
  chat: UseChatHelpers<AskAiMessage>;
  model: string;
  askedRef: RefObject<string>;
}

const AskAiContext = createContext<AskAiState | null>(null);

// Next does not apply basePath to a fetch URL, so the chat route carries the
// /docs prefix in production the same way the search client does.
const chatTransport = new DefaultChatTransport({api: `${basePath}/api/chat`});

function useAskAi(): AskAiState {
  const state = use(AskAiContext);
  if (!state) throw new Error('Ask AI components must render inside <AskAi>.');
  return state;
}

/**
 * Renders the Ask AI trigger and its chat panel. Both are direct children of
 * the docs layout grid, so the panel can take the table-of-contents column on
 * wide screens instead of floating over the page.
 */
export function AskAi({model}: {model: string}) {
  const [open, setOpen] = useState(false);
  // The question is read back when the answer lands, so the two events share
  // one question and a failure can be attributed to what was asked.
  const askedRef = useRef('');
  const chat = useChat<AskAiMessage>({
    id: 'ask-ai',
    transport: chatTransport,
    messageMetadataSchema: askAiAnswerMetadataSchema,
    onFinish: ({message}) => {
      if (message.role !== 'assistant') return;
      captureDocsEvent(
        'docs_ask_ai_answered',
        askAiAnswerProperties({question: askedRef.current, answer: message, model}),
      );
    },
    onError: (error) => {
      captureDocsEvent('docs_ask_ai_failed', {
        ...askAiQuestionProperties(askedRef.current),
        reason: askAiFailureReason(error),
      });
    },
  });

  return (
    <AskAiContext
      value={useMemo(() => ({open, setOpen, chat, model, askedRef}), [open, chat, model])}
    >
      <AskAiTrigger />
      {open ? <AskAiPanel /> : null}
    </AskAiContext>
  );
}

function AskAiTrigger() {
  const {open, setOpen} = useAskAi();

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={clsx(
        'fixed bottom-4 inset-e-4 z-20 w-28 shadow-lg transition-[translate,opacity]',
        open && 'translate-y-10 opacity-0',
        buttonVariants({variant: 'secondary', className: 'gap-inline rounded-2xl'}),
      )}
    >
      <MessageCircleIcon className="size-4" />
      Ask AI
    </button>
  );
}

function AskAiPanel() {
  const {setOpen} = useAskAi();
  useCloseOnEscape();

  return (
    <>
      <button
        type="button"
        aria-label="Close Ask AI"
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-30 animate-fd-fade-in bg-fd-overlay backdrop-blur-xs lg:hidden"
      />
      <div
        className={clsx(
          'z-30 flex flex-col overflow-hidden bg-fd-card text-fd-card-foreground',
          'max-lg:fixed max-lg:inset-x-2 max-lg:inset-y-4 max-lg:animate-fd-dialog-in max-lg:rounded-2xl max-lg:border max-lg:shadow-xl',
          'lg:sticky lg:top-0 lg:ms-auto lg:h-dvh lg:w-100 lg:border-s lg:in-[#nd-docs-layout]:[grid-area:toc]',
        )}
      >
        <AskAiHeader />
        <AskAiConversation />
        <AskAiComposer />
      </div>
    </>
  );
}

function AskAiHeader() {
  const {setOpen} = useAskAi();

  return (
    <div className="flex items-start gap-inline border-b px-row py-row">
      <div className="flex flex-1 flex-col gap-tight">
        <p className="text-sm font-medium">Ask AI</p>
        <p className="text-xs text-fd-muted-foreground">
          Answers come from these docs and can be wrong. Check the linked pages.
        </p>
      </div>
      <button
        type="button"
        aria-label="Close Ask AI"
        onClick={() => setOpen(false)}
        className={buttonVariants({
          variant: 'ghost',
          size: 'icon-sm',
          className: 'rounded-full text-fd-muted-foreground',
        })}
      >
        <XIcon />
      </button>
    </div>
  );
}

function AskAiConversation() {
  const {messages, error, status} = useAskAi().chat;
  const containerRef = useRef<HTMLDivElement>(null);
  const isAnswering = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    const container = containerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  if (messages.length === 0)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-inline p-panel text-center text-sm text-fd-muted-foreground">
        <MessageCircleIcon className="size-5" />
        <p>Ask a question about Shipfox workflows, runners, or integrations.</p>
      </div>
    );

  return (
    <div
      ref={containerRef}
      className="fd-scroll-container flex flex-1 flex-col gap-group overflow-y-auto overscroll-contain px-row py-row"
    >
      {messages.map((message, index) => (
        <MessageView
          key={message.id}
          message={message}
          settled={!isAnswering || index < messages.length - 1}
        />
      ))}
      {error ? (
        <div className="rounded-lg border bg-fd-secondary p-tight text-sm text-fd-secondary-foreground">
          <p className="text-xs text-fd-muted-foreground">Request failed</p>
          <p>{error.message}</p>
        </div>
      ) : null}
    </div>
  );
}

const ROLE_LABEL = {user: 'You', assistant: 'Shipfox docs', system: 'System'} as const;

function MessageView({message, settled}: {message: AskAiMessage; settled: boolean}) {
  const hasText = message.parts.some((part) => part.type === 'text' && part.text.length > 0);

  return (
    <div className="flex flex-col gap-inline">
      <p
        className={clsx(
          'text-sm font-medium',
          message.role === 'assistant' ? 'text-fd-primary' : 'text-fd-muted-foreground',
        )}
      >
        {ROLE_LABEL[message.role]}
      </p>
      {/* Parts stay in order so a retrieval step reads above the text it produced. */}
      {message.parts.map((part, index) => {
        if (part.type === 'tool-read_page') return <ReadStep key={part.toolCallId} part={part} />;
        if (part.type !== 'text') return null;
        return <AnswerMarkdown key={`text-${index}`} text={part.text} />;
      })}
      {message.role === 'assistant' && settled && !hasText ? <NoAnswerNotice /> : null}
    </div>
  );
}

/**
 * A turn can end having only read pages, which would otherwise render as a
 * silent list of steps and read as a hang.
 */
function NoAnswerNotice() {
  return (
    <div className="rounded-lg border bg-fd-secondary p-tight text-sm text-fd-secondary-foreground">
      <p>
        I could not put an answer together from these pages. Try rewording the question, or retry.
      </p>
    </div>
  );
}

type ReadPart = Extract<AskAiMessage['parts'][number], {type: 'tool-read_page'}>;

function ReadStep({part}: {part: ReadPart}) {
  return (
    <div className="flex items-center gap-inline rounded-lg border bg-fd-secondary p-tight text-xs text-fd-muted-foreground">
      <FileTextIcon className="size-4 shrink-0" />
      <ReadStepLabel part={part} />
    </div>
  );
}

function ReadStepLabel({part}: {part: ReadPart}) {
  if (part.state === 'output-error' || part.state === 'output-denied')
    return <p className="text-fd-primary">{part.errorText ?? 'That page could not be read.'}</p>;
  if (part.state !== 'output-available') return <p>Reading the docs…</p>;
  return <p>{`Read ${part.output.title}`}</p>;
}

function AskAiComposer() {
  const {model, askedRef} = useAskAi();
  const {status, messages, sendMessage, stop, setMessages, regenerate} = useAskAi().chat;
  const [question, setQuestion] = useState('');
  const isAnswering = status === 'submitted' || status === 'streaming';

  const ask = () => {
    const text = question.trim();
    if (text.length === 0) return;
    askedRef.current = text;
    captureDocsEvent('docs_ask_ai_question_asked', askAiQuestionProperties(text));
    void sendMessage({
      role: 'user',
      parts: [
        {type: 'data-client', data: {location: window.location.href}},
        {type: 'text', text},
      ],
    });
    setQuestion('');
  };

  return (
    <div className="flex flex-col gap-inline border-t px-row py-row">
      <form
        className="flex items-end gap-inline"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the panel opens on an explicit action to ask a question
          autoFocus
          rows={2}
          value={question}
          placeholder={isAnswering ? 'Answering…' : 'Ask a question'}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.shiftKey || event.key !== 'Enter') return;
            event.preventDefault();
            ask();
          }}
          className="flex-1 resize-none rounded-xl border bg-fd-secondary p-tight text-sm text-fd-secondary-foreground placeholder:text-fd-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
        />
        {isAnswering ? (
          <button
            type="button"
            aria-label="Stop answering"
            onClick={stop}
            className={buttonVariants({
              variant: 'secondary',
              size: 'icon',
              className: 'rounded-full',
            })}
          >
            <Loader2 className="size-4 animate-spin" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send question"
            disabled={question.trim().length === 0}
            className={buttonVariants({
              variant: 'primary',
              size: 'icon',
              className: 'rounded-full',
            })}
          >
            <SendIcon className="size-4" />
          </button>
        )}
      </form>
      {messages.length > 0 ? (
        <div className="flex items-center gap-inline">
          {!isAnswering && messages.at(-1)?.role === 'assistant' ? (
            <button
              type="button"
              onClick={() => {
                captureDocsEvent('docs_ask_ai_retried', {model});
                void regenerate();
              }}
              className={buttonVariants({
                variant: 'ghost',
                size: 'sm',
                className: 'gap-tight rounded-full text-fd-muted-foreground',
              })}
            >
              <RotateCcw className="size-3" />
              Retry
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setMessages([])}
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
              className: 'rounded-full text-fd-muted-foreground',
            })}
          >
            Clear chat
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AnswerMarkdown({text}: {text: string}) {
  return (
    <div className="prose prose-no-margin text-sm">
      <Markdown remarkPlugins={[remarkGfm]} components={ANSWER_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}

const ANSWER_COMPONENTS: Components = {
  a: AnswerLink,
  pre: AnswerCodeBlock,
  img: () => null,
};

function AnswerLink({href, children}: ComponentProps<'a'>) {
  const link = resolveCitationLink(href, basePath);
  return (
    <a
      href={link.href}
      target={link.external ? '_blank' : undefined}
      rel={link.external ? 'noreferrer' : undefined}
      onClick={() =>
        captureDocsEvent('docs_ask_ai_citation_clicked', {
          destination_path: sanitizeTrackedUrl(link.href ?? ''),
          external: link.external,
        })
      }
    >
      {children}
    </a>
  );
}

function AnswerCodeBlock({children}: ComponentProps<'pre'>): ReactNode {
  const code = isValidElement<ComponentProps<'code'>>(children) ? children : undefined;
  const content = code?.props.children;
  if (typeof content !== 'string') return <pre>{children}</pre>;

  return <DynamicCodeBlock lang={codeLanguage(code?.props.className)} code={content.trimEnd()} />;
}

function useCloseOnEscape() {
  const {setOpen} = useAskAi();
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    setOpen(false);
    event.preventDefault();
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);
}
