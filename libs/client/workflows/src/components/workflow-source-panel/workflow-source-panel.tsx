import {
  Button,
  CodeBlock,
  CodeBlockBody,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockFiles,
  CodeBlockHeader,
  CodeBlockItem,
  cn,
  Header,
  Text,
} from '@shipfox/react-ui';
import type {KeyboardEvent, PointerEvent as ReactPointerEvent} from 'react';
import {useRef, useState} from 'react';
import type {WorkflowSourceSnapshot} from '#core/workflow-run.js';

const WORKFLOW_SOURCE_FILENAME = 'workflow.yaml';

const MIN_WIDTH = 420;
const MAX_WIDTH = 1280;
const DEFAULT_WIDTH = 720;
const KEYBOARD_STEP = 24;

// The panel holds wrapped-free YAML, so it wants far more room than the 360–420px
// details rail in DESIGN.md §6 (see the 2026-06-24 decisions-log entry). Cap the drag
// at 85% of the viewport so the run content beside it never collapses to nothing.
function clampWidth(value: number) {
  const viewportMax =
    typeof window === 'undefined' ? MAX_WIDTH : Math.round(window.innerWidth * 0.85);
  const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportMax));
  return Math.min(Math.max(Math.round(value), MIN_WIDTH), max);
}

export interface WorkflowSourcePanelProps {
  id: string;
  source: WorkflowSourceSnapshot | null;
  open: boolean;
  onClose: () => void;
  className?: string | undefined;
}

export function WorkflowSourcePanel({
  id,
  source,
  open,
  onClose,
  className,
}: WorkflowSourcePanelProps) {
  const [width, setWidth] = useState(() => clampWidth(DEFAULT_WIDTH));
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  }

  function startPointerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = widthRef.current;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    setResizing(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    function handleMove(moveEvent: PointerEvent) {
      // Panel is anchored to the right edge, so dragging left (smaller clientX) widens it.
      setWidth(clampWidth(startWidth + (startX - moveEvent.clientX)));
    }

    function handleUp() {
      setResizing(false);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    }

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setWidth((current) => clampWidth(current + KEYBOARD_STEP));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setWidth((current) => clampWidth(current - KEYBOARD_STEP));
    }
  }

  return (
    <section
      id={id}
      aria-label="Workflow source"
      aria-hidden={!open}
      onKeyDown={handleKeyDown}
      style={{width: open ? `${width}px` : 0}}
      className={cn(
        'relative min-h-0 shrink-0 overflow-hidden bg-background-subtle-base motion-reduce:transition-none',
        resizing ? 'transition-none' : 'transition-[width,opacity] duration-200 ease-out',
        open ? 'border-l border-border-neutral-base opacity-100' : 'opacity-0',
        className,
      )}
    >
      {open && source ? (
        <>
          <PanelResizeHandle
            width={width}
            onPointerDown={startPointerResize}
            onKeyDown={handleResizeKeyDown}
            resizing={resizing}
          />
          <WorkflowSourcePanelContent source={source} onClose={onClose} />
        </>
      ) : null}
    </section>
  );
}

function PanelResizeHandle({
  width,
  onPointerDown,
  onKeyDown,
  resizing,
}: {
  width: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  resizing: boolean;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA's window-splitter pattern needs a focusable role="separator" with aria-valuenow; <hr> cannot be interactive or carry the drag affordance.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize source panel"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 left-0 z-10 flex w-8 cursor-col-resize touch-none justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-background-accent-blue-base"
    >
      <span
        aria-hidden="true"
        className={cn(
          'w-px transition-colors duration-150',
          resizing
            ? 'bg-background-accent-blue-base'
            : 'bg-transparent group-hover:bg-border-neutral-strong',
        )}
      />
    </div>
  );
}

function WorkflowSourcePanelContent({
  source,
  onClose,
}: {
  source: WorkflowSourceSnapshot;
  onClose: () => void;
}) {
  const data = [
    {
      language: 'yaml',
      filename: WORKFLOW_SOURCE_FILENAME,
      code: source.content,
    },
  ];

  return (
    <div className="flex size-full min-w-0 flex-col">
      <div className="flex min-h-52 items-center gap-12 border-b border-border-neutral-base px-16 py-10">
        <div className="min-w-0 flex-1">
          <Header variant="h3" className="truncate">
            Workflow source
          </Header>
          <Text size="xs" className="truncate text-foreground-neutral-subtle">
            {WORKFLOW_SOURCE_FILENAME}
          </Text>
        </div>
        <Button
          type="button"
          variant="transparentMuted"
          size="sm"
          iconLeft="close"
          aria-label="Close source"
          onClick={onClose}
        />
      </div>

      <div className="min-h-0 flex-1 p-12">
        <CodeBlock data={data}>
          <CodeBlockHeader>
            <CodeBlockFiles>
              {(item) => (
                <CodeBlockFilename value={item.filename}>{item.filename}</CodeBlockFilename>
              )}
            </CodeBlockFiles>
            <CodeBlockCopyButton />
          </CodeBlockHeader>
          <CodeBlockBody className="min-h-0">
            {(item) => (
              <CodeBlockItem value={item.filename} className="h-full">
                <WorkflowSourceCode code={item.code} />
              </CodeBlockItem>
            )}
          </CodeBlockBody>
        </CodeBlock>
      </div>
    </div>
  );
}

function WorkflowSourceCode({code}: {code: string}) {
  return (
    <pre className="w-full font-code">
      <code>
        {sourceLines(code).map(({key, line}) => (
          <span className="line" key={key}>
            {line}
          </span>
        ))}
      </code>
    </pre>
  );
}

function sourceLines(code: string) {
  let offset = 0;
  return code.split('\n').map((line) => {
    const key = `${offset}:${line}`;
    offset += line.length + 1;
    return {key, line};
  });
}
