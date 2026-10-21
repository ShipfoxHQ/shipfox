'use client';

import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  GitPullRequest,
  type LucideIcon,
  ShieldCheck,
  Sparkle,
} from 'lucide-react';
import {type ReactNode, type RefObject, useEffect, useRef, useState} from 'react';
import {TemplateIcon} from '@/app/components/template-catalog/template-icon';
import {
  agentDescription,
  agentName,
  buildFrames,
  cycleDescriptions,
  type FeedEntry,
  feedLength,
  type LoopFrame,
  type LoopStage,
  loopCaption,
  moreToolsCount,
  type PullRequestFrame,
  type PullRequestState,
  platformTools,
  runWindow,
  type WorkflowRow,
  watchedTools,
} from '@/lib/improvement-loop';

const frames = buildFrames();
const lastFrame = frames.length - 1;
const tickDuration = 900;

const stageLabels: Record<LoopStage, string> = {
  find: 'Find',
  ship: 'Ship',
  improve: 'Improve',
};

const pullRequestBadges: Record<PullRequestState, {icon: LucideIcon; label: string; tone: string}> =
  {
    review: {
      icon: GitPullRequest,
      label: 'Review requested',
      tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    },
    approved: {
      icon: ShieldCheck,
      label: 'Approved by you',
      tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    },
  };

// Rendered as HTML so search engines and screen readers get the text. The drawing is hidden
// from assistive technology and paired with sentences that state the same facts in order.
// The server renders the last frame, which is also what reduced motion and the README
// screenshot show. With motion allowed, the loop plays while it is on screen and pauses while
// the pointer is over it.
export function ImprovementLoop() {
  const figureRef = useRef<HTMLElement>(null);
  const tick = useTick(figureRef);
  const frame = frames[tick] ?? frames[lastFrame];

  return (
    <figure ref={figureRef} className="not-prose @container my-region flex flex-col gap-inline">
      <figcaption className="sr-only">{loopCaption}</figcaption>
      <p className="sr-only">{agentDescription}</p>
      <ol className="sr-only">
        {cycleDescriptions.map((summary) => (
          <li key={summary}>{summary}</li>
        ))}
      </ol>

      {frame ? <LoopDrawing frame={frame} /> : null}
    </figure>
  );
}

function LoopDrawing({frame}: {frame: LoopFrame}) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-inline">
      <AgentPanel frame={frame} />

      <div className="grid gap-inline @2xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <ObserveRail active={frame.active === 'observe'} />
        <div className="flex flex-col gap-inline">
          <Connector label="proposes" active={frame.active === 'propose'} />
          <TeamPanel pullRequest={frame.pullRequest} />
          <Connector label="merged" active={frame.active === 'merge'} />
        </div>
      </div>

      <PlatformPanel workflows={frame.workflows} />
    </div>
  );
}

function useTick(ref: RefObject<HTMLElement | null>): number {
  const [tick, setTick] = useState(lastFrame);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    setTick(0);
    let visible = false;
    let hovered = false;
    const timer = window.setInterval(() => {
      if (!visible || hovered) return;
      setTick((current) => (current >= lastFrame ? 0 : current + 1));
    }, tickDuration);
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
      },
      {threshold: 0.4},
    );
    observer.observe(element);
    const pause = () => {
      hovered = true;
    };
    const resume = () => {
      hovered = false;
    };
    element.addEventListener('pointerenter', pause);
    element.addEventListener('pointerleave', resume);

    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      element.removeEventListener('pointerenter', pause);
      element.removeEventListener('pointerleave', resume);
    };
  }, [ref]);

  return tick;
}

function PanelHeading({children, aside}: {children: ReactNode; aside?: ReactNode}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-inline">
      <h3 className="inline-flex items-center gap-tight font-mono text-xs font-normal uppercase tracking-[0.2em] text-fd-muted-foreground">
        {children}
      </h3>
      {aside}
    </div>
  );
}

function AgentPanel({frame}: {frame: LoopFrame}) {
  // Empty slots keep the panel the same height while the log fills up.
  const emptySlots = Array.from({length: feedLength - frame.feed.length}, (_, index) => index);

  return (
    <section className="flex flex-col gap-group rounded-lg border border-fd-primary/40 bg-fd-primary/5 p-panel-compact">
      <PanelHeading
        aside={
          <span className="inline-flex items-baseline gap-inline font-mono text-xs text-fd-muted-foreground">
            <ObservingGlyph />
            watching {frame.watchedWorkflows} workflows · {watchedTools} tools ·{' '}
            {frame.watchedRuns.toLocaleString('en-US')} runs
          </span>
        }
      >
        <Sparkle className="size-3.5 text-fd-primary" />
        <span className="text-fd-foreground">{agentName}</span>
      </PanelHeading>
      <ol className="flex flex-col gap-tight font-mono text-xs">
        {emptySlots.map((slot) => (
          <li key={`empty-${slot}`} className="invisible">
            ›
          </li>
        ))}
        {frame.feed.map((entry) => (
          <FeedLine key={entry.id} entry={entry} />
        ))}
      </ol>
    </section>
  );
}

function FeedLine({entry}: {entry: FeedEntry}) {
  return (
    <li className="grid grid-cols-[11ch_minmax(0,1fr)] items-baseline gap-inline">
      <span className="whitespace-nowrap uppercase tracking-wide text-fd-primary">
        › {stageLabels[entry.stage]}
      </span>
      <span className="text-fd-foreground @xl:truncate">{entry.text}</span>
    </li>
  );
}

// The same ripple the product uses for live work.
function ObservingGlyph() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex size-full rounded-full bg-fd-primary opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-fd-primary" />
    </span>
  );
}

function connectorTone(active: boolean): string {
  return active ? 'text-fd-primary' : 'text-fd-muted-foreground';
}

// The line from the platform up to the agent passes beside the team: observing needs no review.
function ObserveRail({active}: {active: boolean}) {
  return (
    <div
      className={`hidden flex-col items-center font-mono text-xs transition-colors duration-200 ease-out @2xl:flex ${connectorTone(active)}`}
    >
      <ChevronUp className="size-4 shrink-0 translate-y-1/3" />
      <span className="w-0 flex-1 border-l border-dashed border-current" />
      <span className="py-tight">observes</span>
      <span className="w-0 flex-1 border-l border-dashed border-current" />
    </div>
  );
}

function Connector({label, active}: {label: string; active: boolean}) {
  return (
    <span
      className={`inline-flex items-center justify-center gap-tight font-mono text-xs transition-colors duration-200 ease-out ${connectorTone(active)}`}
    >
      <span className="flex h-8 flex-col-reverse items-center">
        <ChevronDown className="size-4 shrink-0 -translate-y-1/3" />
        <span className="w-px flex-1 bg-current" />
      </span>
      {label}
    </span>
  );
}

function TeamPanel({pullRequest}: {pullRequest?: PullRequestFrame}) {
  return (
    <section className="flex flex-col gap-group rounded-lg border border-dashed border-fd-border p-panel-compact">
      <PanelHeading>Your team</PanelHeading>
      <div className="flex min-h-14 flex-col gap-inline rounded-md border border-fd-border bg-fd-card p-panel-compact @xl:flex-row @xl:items-center @xl:justify-between">
        {pullRequest ? (
          <PullRequestRow pullRequest={pullRequest} />
        ) : (
          <span className="font-mono text-xs text-fd-muted-foreground">No change waiting</span>
        )}
      </div>
    </section>
  );
}

function PullRequestRow({pullRequest}: {pullRequest: PullRequestFrame}) {
  const badge = pullRequestBadges[pullRequest.state];
  const BadgeIcon = badge.icon;

  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-cluster">
        <TemplateIcon icon="github" className="size-5 shrink-0 text-fd-foreground" />
        <span className="truncate text-sm font-medium text-fd-foreground">
          <span className="font-mono text-fd-muted-foreground">#{pullRequest.number}</span>{' '}
          {pullRequest.title}
        </span>
      </span>
      <span
        className={`inline-flex shrink-0 items-center gap-tight self-start rounded-md border px-tight text-xs font-medium transition-colors duration-200 ease-out @xl:self-auto ${badge.tone}`}
      >
        <BadgeIcon className="size-3.5" />
        {badge.label}
      </span>
    </>
  );
}

function PlatformPanel({workflows}: {workflows: WorkflowRow[]}) {
  return (
    <section className="flex flex-col gap-group rounded-lg border border-dashed border-fd-border p-panel-compact">
      <PanelHeading
        aside={
          <ul className="flex flex-wrap items-center gap-tight">
            {platformTools.map((tool) => (
              <li
                key={tool}
                className="flex size-7 items-center justify-center rounded-md border border-fd-border bg-fd-card text-fd-foreground"
              >
                <TemplateIcon icon={tool} className="size-3.5" />
              </li>
            ))}
            <li className="px-tight font-mono text-xs text-fd-muted-foreground">
              +{moreToolsCount}
            </li>
          </ul>
        }
      >
        Shipfox platform
      </PanelHeading>
      <ul className="flex flex-col gap-inline">
        {workflows.map((workflow) => (
          <WorkflowLine key={workflow.name} workflow={workflow} />
        ))}
      </ul>
    </section>
  );
}

function WorkflowLine({workflow}: {workflow: WorkflowRow}) {
  // Empty slots keep every strip the same width, with the newest run on the right.
  const emptySlots = Array.from({length: runWindow - workflow.runs.length}, (_, index) => index);

  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-cluster gap-y-tight font-mono text-xs transition-opacity duration-200 ease-out @xl:grid-cols-[14ch_auto_minmax(0,1fr)] ${workflow.visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <span className="truncate text-fd-foreground">{workflow.name}</span>
      <span
        className={`text-right transition-colors duration-200 ease-out @xl:order-last ${workflow.metric?.improved ? 'text-emerald-700 dark:text-emerald-400' : 'text-fd-muted-foreground'}`}
      >
        {workflow.metric?.label}
      </span>
      <ol className="col-span-2 flex gap-tight @xl:col-span-1">
        {emptySlots.map((slot) => (
          <li key={`empty-${slot}`} className="size-4" />
        ))}
        {workflow.runs.map((run) => (
          <li key={run.id}>
            {run.status === 'failed' ? (
              <CircleX className="size-4 text-red-600 dark:text-red-400" />
            ) : (
              <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
            )}
          </li>
        ))}
      </ol>
    </li>
  );
}
