import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clock,
  CornerLeftUp,
  FileCode,
  FileText,
  GitBranch,
  Lightbulb,
  type LucideIcon,
  MessageSquare,
  SearchCheck,
  ShieldCheck,
  Sparkle,
  Terminal,
  Webhook,
  Wrench,
} from 'lucide-react';
import type {ReactNode} from 'react';
import {TemplateIcon} from '@/app/components/template-catalog/template-icon';
import {templateIconLabels} from '@/lib/template-catalog/types';
import {
  describeWorkflowStep,
  exampleRun,
  exampleRunDescription,
  handoffDescription,
  otherResults,
  resumeLabel,
  reviewChecks,
  teamDescription,
  type WorkflowStep,
  type WorkflowStepKind,
  workflowFile,
  workflowRunner,
  workflowSteps,
  workflowTriggerBrands,
  workflowTriggersDescription,
} from '@/lib/workflow-overview';

const stepKinds: Record<
  WorkflowStepKind,
  {label: string; icon: LucideIcon; node: string; iconTone: string}
> = {
  agent: {
    label: 'Agent',
    icon: Sparkle,
    node: 'border-fd-primary/40 bg-fd-primary/10',
    iconTone: 'text-fd-primary',
  },
  tool: {label: 'Tool', icon: Wrench, node: 'border-fd-border bg-fd-card', iconTone: ''},
  run: {label: 'Run', icon: Terminal, node: 'border-fd-border bg-fd-card', iconTone: ''},
};

const reviewCheckIcons: Record<(typeof reviewChecks)[number], LucideIcon> = {
  'Tests passing': MessageSquare,
  'Summary of changes': FileText,
  'Small and focused': GitBranch,
  'Ready for review': ShieldCheck,
};

const otherResultIcons: Record<(typeof otherResults)[number], LucideIcon> = {
  Diagnosis: SearchCheck,
  'Suggested improvement': Lightbulb,
};

// Every step row shares this template so the loop arrows line up with the steps they join.
const stepColumns = '@2xl:grid-cols-[repeat(4,minmax(0,1fr)_1rem)_minmax(0,1fr)]';
const fixColumn = '@2xl:col-start-5';
const openPrColumn = '@2xl:col-start-9';

// Rendered as HTML rather than an image so search engines and screen readers get the text.
// Each visual group is hidden from assistive technology and paired with one sentence that
// states the same facts in reading order.
export function WorkflowOverview() {
  return (
    <figure className="not-prose @container my-region flex flex-col gap-inline">
      <figcaption className="sr-only">How a Shipfox workflow runs</figcaption>

      <Stage number={1} title="Triggers">
        <p className="sr-only">{workflowTriggersDescription}</p>
        <div
          aria-hidden="true"
          className="flex flex-col gap-cluster @2xl:flex-row @2xl:items-center @2xl:justify-between"
        >
          <ul className="flex flex-wrap gap-inline">
            {workflowTriggerBrands.map((brand) => (
              <TriggerTile key={brand} label={templateIconLabels[brand]}>
                <TemplateIcon icon={brand} className="size-5" />
              </TriggerTile>
            ))}
            <TriggerTile label="Schedule">
              <Clock className="size-5" />
            </TriggerTile>
            <TriggerTile label="Webhook">
              <Webhook className="size-5" />
            </TriggerTile>
          </ul>
          <p className="text-sm text-fd-muted-foreground">Ticket, PR, alert, check, schedule…</p>
        </div>
      </Stage>

      <div className="flex justify-center text-fd-muted-foreground">
        <VerticalArrow direction="down" />
      </div>

      <Stage number={2} title="Agent workflow" qualifier={workflowRunner} aside={<WorkflowFile />}>
        <div className="flex flex-col gap-tight">
          <TestLoop />
          <ol className={`flex flex-col gap-tight @2xl:grid ${stepColumns}`}>
            {workflowSteps.map((step, index) => (
              <li key={step.title} className="flex flex-col items-center gap-tight @2xl:contents">
                <span className="sr-only">{describeWorkflowStep(step)}</span>
                {index > 0 ? (
                  <>
                    <ArrowDown
                      aria-hidden="true"
                      className="size-4 shrink-0 text-fd-muted-foreground @2xl:hidden"
                    />
                    <ArrowRight
                      aria-hidden="true"
                      className="hidden size-4 shrink-0 self-center text-fd-muted-foreground @2xl:block"
                    />
                  </>
                ) : null}
                <StepNode step={step} />
                {step.loopsTo !== undefined ? (
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center gap-tight text-xs text-fd-muted-foreground @2xl:hidden"
                  >
                    <CornerLeftUp className="size-3.5" />
                    On failure, back to “{workflowSteps[step.loopsTo]?.title}”
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
        <RunFooter />
      </Stage>

      <ResultConnector />

      <Stage number={3} title="Your team">
        <p className="sr-only">{teamDescription}</p>
        <div
          aria-hidden="true"
          className="flex flex-col gap-group rounded-md border border-fd-border bg-fd-card p-panel-compact @xl:flex-row @xl:items-start @xl:justify-between"
        >
          <div className="flex items-center gap-cluster">
            <TemplateIcon icon="github" className="size-6 text-fd-foreground" />
            <span className="font-medium text-fd-foreground">Pull request</span>
            <span className="inline-flex items-center gap-tight rounded-md border border-emerald-500/30 bg-emerald-500/10 px-tight text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Ready
              <Check className="size-3.5" />
            </span>
          </div>
          <ul className="grid gap-x-section gap-y-inline text-sm text-fd-muted-foreground @xl:grid-cols-2">
            {reviewChecks.map((label) => {
              const Icon = reviewCheckIcons[label];
              return (
                <li key={label} className="flex items-center gap-inline">
                  <Icon className="size-4 shrink-0" />
                  {label}
                </li>
              );
            })}
          </ul>
        </div>
        <div
          aria-hidden="true"
          className="flex flex-wrap items-center gap-inline text-sm text-fd-muted-foreground"
        >
          <span className="font-mono text-xs">or</span>
          {otherResults.map((label) => {
            const Icon = otherResultIcons[label];
            return (
              <span
                key={label}
                className="inline-flex items-center gap-inline rounded-md border border-dashed border-fd-border px-tight py-tight"
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </span>
            );
          })}
        </div>
      </Stage>
    </figure>
  );
}

function Stage({
  number,
  title,
  qualifier,
  aside,
  children,
}: {
  number: number;
  title: string;
  qualifier?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-group rounded-lg border border-dashed border-fd-border p-panel-compact">
      <div className="flex flex-wrap items-center justify-between gap-inline">
        <h3 className="font-mono text-xs font-normal text-fd-muted-foreground">
          <span className="uppercase tracking-[0.2em]">
            {number}. {title}
          </span>
          {qualifier ? <span> · {qualifier}</span> : null}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// What one run leaves behind, shown as run metadata rather than as a feature list.
function RunFooter() {
  return (
    <>
      <p className="sr-only">{exampleRunDescription}</p>
      <div
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-x-section gap-y-tight border-t border-dashed border-fd-border pt-[var(--space-cluster)] font-mono text-xs text-fd-muted-foreground"
      >
        <span className="inline-flex items-center gap-inline">
          <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>
            run #{exampleRun.number} · {exampleRun.duration} · ~{exampleRun.cost}
          </span>
        </span>
        <span>logs · session · metrics</span>
      </div>
    </>
  );
}

function WorkflowFile() {
  return (
    <span className="inline-flex min-w-0 items-center gap-tight rounded-md border border-fd-border bg-fd-card px-tight py-tight font-mono text-xs">
      <FileCode aria-hidden="true" className="size-3.5 shrink-0 text-fd-muted-foreground" />
      <span className="truncate">
        <span className="sr-only">Defined in </span>
        <span className="text-fd-muted-foreground">{workflowFile.directory}</span>
        <span className="text-fd-foreground">{workflowFile.name}</span>
      </span>
    </span>
  );
}

function TriggerTile({label, children}: {label: string; children: ReactNode}) {
  return (
    <li
      title={label}
      className="flex size-10 items-center justify-center rounded-md border border-fd-border bg-fd-card text-fd-foreground"
    >
      {children}
    </li>
  );
}

function StepNode({step}: {step: WorkflowStep}) {
  const kind = stepKinds[step.kind];
  const Icon = kind.icon;
  return (
    <div
      aria-hidden="true"
      className={`flex w-full min-w-0 flex-col gap-tight rounded-md border p-tight ${kind.node}`}
    >
      <span className="flex items-center justify-between gap-tight text-xs text-fd-muted-foreground">
        <span className="inline-flex items-center gap-tight font-medium uppercase tracking-wide">
          <Icon className={`size-3.5 shrink-0 ${kind.iconTone}`} />
          {kind.label}
        </span>
        {step.cost ? <span className="font-mono">~{step.cost}</span> : null}
      </span>
      <span
        className={`truncate text-sm font-medium text-fd-foreground ${step.kind === 'run' ? 'font-mono' : ''}`}
      >
        {step.title}
      </span>
      {step.model ? (
        <span className="self-start whitespace-nowrap rounded border border-fd-border bg-fd-card px-tight font-mono text-xs leading-5 text-fd-foreground">
          {step.model}
        </span>
      ) : null}
      {step.scope ? (
        <span className="inline-flex items-center gap-tight text-xs text-fd-muted-foreground">
          {step.scope.provider ? (
            <TemplateIcon icon={step.scope.provider} className="size-3" />
          ) : (
            <FileCode className="size-3 shrink-0" />
          )}
          {step.scope.label}
        </span>
      ) : null}
    </div>
  );
}

// Drawn above the steps: the test step sends failures back to the fix step.
function TestLoop() {
  return (
    <div aria-hidden="true" className={`hidden @2xl:grid ${stepColumns}`}>
      <div className="col-start-5 col-end-8 flex flex-col items-center gap-tight font-mono text-xs text-fd-muted-foreground">
        on failure
        <div className="relative h-3 w-1/2 rounded-t-md border-x border-t border-dashed border-fd-muted-foreground">
          <ChevronDown className="absolute -bottom-2 -left-[8.5px] size-4" />
        </div>
      </div>
    </div>
  );
}

// Sits just left of its arrow, whatever the column width.
const arrowLabel =
  'absolute top-1/2 right-[calc(50%+var(--space-region))] -translate-y-1/2 whitespace-nowrap';

// Between the workflow and the team: the result goes down from the PR step, and a comment comes
// back up into the fix step.
function ResultConnector() {
  return (
    <>
      <p className="sr-only">{handoffDescription}</p>
      <div
        aria-hidden="true"
        className={`hidden px-[calc(var(--pad-panel-compact)+1px)] font-mono text-xs @2xl:grid ${stepColumns}`}
      >
        <div className={`relative flex justify-center text-fd-muted-foreground ${fixColumn}`}>
          <VerticalArrow direction="up" />
          <span className={`${arrowLabel} text-right`}>
            {resumeLabel[0]}
            <br />
            {resumeLabel[1]}
          </span>
        </div>
        <div className={`relative flex justify-center text-fd-muted-foreground ${openPrColumn}`}>
          <VerticalArrow direction="down" />
          <span className={arrowLabel}>Result</span>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="flex flex-col items-center gap-tight font-mono text-xs @2xl:hidden"
      >
        <span className="inline-flex items-center gap-tight text-fd-muted-foreground">
          <ArrowDown className="size-4" />
          Result
        </span>
        <span className="inline-flex items-start gap-tight text-fd-muted-foreground">
          <CornerLeftUp className="size-4 shrink-0" />
          <span>
            {resumeLabel[0]}
            <br />
            {resumeLabel[1]}
          </span>
        </span>
      </div>
    </>
  );
}

function VerticalArrow({direction}: {direction: 'up' | 'down'}) {
  const Head = direction === 'up' ? ChevronUp : ChevronDown;
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 flex-col items-center ${direction === 'up' ? '' : 'flex-col-reverse'}`}
    >
      <Head className={`size-4 shrink-0 ${direction === 'up' ? '-mb-2' : '-mt-2'}`} />
      <span className="w-px flex-1 bg-current" />
    </span>
  );
}
