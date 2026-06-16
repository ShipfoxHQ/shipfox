import {Button, Code, cn, Icon, Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui';
import type {ReactNode} from 'react';
import {formatDuration} from '../lib/workflow-dashboard-format.js';
import {workflowStatusLabel, workflowStatusTextClass} from '../lib/workflow-dashboard-status.js';
import type {
  WorkflowDashboardAttempt,
  WorkflowDashboardJob,
  WorkflowDashboardStep,
} from '../workflow-dashboard-types.js';
import {StatusDot} from './status-badge.js';

export function StepList({
  attemptByStep,
  expanded,
  job,
  onSelectAttempt,
  onToggle,
  renderPanel,
}: {
  attemptByStep: Record<string, number>;
  expanded: Set<string>;
  job: WorkflowDashboardJob;
  onSelectAttempt: (step: string, attempt: number) => void;
  onToggle: (step: string) => void;
  renderPanel: (step: WorkflowDashboardStep) => ReactNode;
}) {
  const restartTargets = new Set(
    job.steps.flatMap((step) => (step.gateInfo ? [step.gateInfo.restartFrom] : [])),
  );

  return (
    <div className="relative flex flex-col gap-6 pl-18">
      <div
        className="absolute top-0 bottom-0 left-8 w-1 bg-border-neutral-base"
        aria-hidden="true"
      />
      {job.steps.map((step, index) => {
        const isExpanded = expanded.has(step.name);
        const selectedAttempt = attemptByStep[step.name] ?? step.attempts.at(-1)?.number ?? null;
        const isRestartSource = Boolean(step.gateInfo);
        const isRestartTarget = restartTargets.has(step.name);

        return (
          <div className="relative" key={step.name}>
            <div
              className={cn(
                'grid w-full grid-cols-[18px_34px_8px_minmax(120px,1fr)_auto_auto] items-center gap-10 rounded-8 border px-12 py-9 text-left shadow-sm transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus focus-visible:outline-none',
                isExpanded
                  ? 'border-border-neutral-strong bg-background-components-base'
                  : 'border-border-neutral-base bg-background-components-base',
                step.status === 'running' && 'border-tag-blue-border',
              )}
            >
              <button
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${step.name}`}
                className="flex size-18 items-center justify-center rounded-4 text-foreground-neutral-muted hover:bg-background-neutral-muted focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
                onClick={() => onToggle(step.name)}
                type="button"
              >
                <Icon
                  name={isExpanded ? 'arrowDownSLine' : 'arrowRightSLine'}
                  className="size-14"
                />
              </button>
              <Code variant="label" className="text-foreground-neutral-muted">
                {String(index + 1).padStart(2, '0')}
              </Code>
              <StatusDot pulse status={step.status} />
              <div className="flex min-w-0 items-center gap-8">
                <Code variant="paragraph" bold className="truncate">
                  {step.name}
                </Code>
                {isRestartTarget && (
                  <Code
                    variant="label"
                    className="rounded-4 bg-tag-warning-bg px-5 py-1 text-tag-warning-text"
                  >
                    restart target
                  </Code>
                )}
                {isRestartSource && (
                  <Code
                    variant="label"
                    className="hidden rounded-4 bg-tag-error-bg px-5 py-1 text-tag-error-text lg:inline"
                  >
                    restart_from {step.gateInfo?.restartFrom}
                  </Code>
                )}
              </div>
              {step.attempts.length > 0 ? (
                <div className="flex items-center gap-4">
                  {step.attempts.map((attempt) => (
                    <AttemptChip
                      attempt={attempt}
                      key={attempt.number}
                      onSelect={() => onSelectAttempt(step.name, attempt.number)}
                      selected={isExpanded && selectedAttempt === attempt.number}
                    />
                  ))}
                </div>
              ) : (
                <Code variant="label" className="text-foreground-neutral-disabled">
                  {step.status === 'pending' ? 'not started' : 'not run'}
                </Code>
              )}
              <Code
                variant="label"
                className={cn(
                  'text-right',
                  step.status === 'running'
                    ? 'text-tag-blue-text'
                    : workflowStatusTextClass(step.status),
                )}
              >
                {step.duration != null
                  ? formatDuration(step.duration)
                  : step.status === 'running'
                    ? 'live'
                    : workflowStatusLabel(step.status)}
              </Code>
            </div>
            {isExpanded && <div className="ml-18">{renderPanel(step)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function AttemptChip({
  attempt,
  onSelect,
  selected,
}: {
  attempt: WorkflowDashboardAttempt;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className={cn(
            'h-20 gap-3 px-5 font-code text-xs',
            selected && 'ring-1 ring-foreground-neutral-base',
          )}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          size="2xs"
          type="button"
          variant="secondary"
        >
          #{attempt.number}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Attempt {attempt.number} - {workflowStatusLabel(attempt.status)} -{' '}
        {formatDuration(attempt.duration)}
      </TooltipContent>
    </Tooltip>
  );
}
