import {Icon} from '@shipfox/react-ui/icon';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import type {
  JobStatusReason,
  NodeConditionLevel,
  NodeConditionSummary,
  StepStatusReason,
} from '#core/workflow-run.js';

type SkipReason = JobStatusReason | StepStatusReason | null;

// Shared skip explanation for a skipped job or step: a reason sentence plus the
// evaluated condition and its result. `condition_errored` (a broken predicate) is
// rendered as a distinct warning signal, not an ordinary muted skip.
export function NodeSkipDetail({
  level,
  statusReason,
  condition,
}: {
  level: NodeConditionLevel;
  statusReason: SkipReason;
  condition: NodeConditionSummary | null;
}) {
  const errored = statusReason === 'condition_errored';

  return (
    <div
      className={cn(
        'flex flex-col gap-8 rounded-8 border px-12 py-10',
        errored
          ? 'border-tag-warning-border bg-tag-warning-bg'
          : 'border-border-neutral-base bg-background-neutral-base',
      )}
    >
      <div className="flex items-center gap-6">
        <Icon
          name={errored ? 'errorWarningLine' : 'forbid2Line'}
          size={14}
          aria-hidden="true"
          className={cn(
            'shrink-0',
            errored ? 'text-tag-warning-icon' : 'text-foreground-neutral-muted',
          )}
        />
        <Text
          size="xs"
          bold
          className={errored ? 'text-tag-warning-text' : 'text-foreground-neutral-base'}
        >
          {errored ? 'Condition error' : 'Skipped'}
        </Text>
      </div>
      <Text size="xs" className="text-foreground-neutral-muted">
        {skipDescription(level, statusReason)}
      </Text>
      {condition ? <ConditionLine condition={condition} /> : null}
    </div>
  );
}

function ConditionLine({condition}: {condition: NodeConditionSummary}) {
  return (
    <div className="flex flex-col gap-4">
      <Text size="xs" className="text-foreground-neutral-muted">
        {condition.isDefaultGate ? 'Default gate' : 'Condition'}
      </Text>
      <div className="flex min-w-0 flex-wrap items-center gap-6">
        <Code
          variant="label"
          className="min-w-0 break-all rounded-4 border border-border-neutral-base bg-background-components-base px-6 py-2 text-foreground-neutral-base"
        >
          {condition.expression}
        </Code>
        {condition.value !== null ? (
          <span className="flex shrink-0 items-center gap-4 text-foreground-neutral-muted">
            <Icon name="arrowRightLine" size={12} aria-hidden="true" />
            <Code variant="label" className="text-foreground-neutral-base">
              {condition.value}
            </Code>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function skipDescription(level: NodeConditionLevel, reason: SkipReason): string {
  if (level === 'job') return skippedJobDescription(reason);
  return skippedStepDescription(reason);
}

function skippedStepDescription(reason: SkipReason): string {
  switch (reason) {
    case 'default_gate_rejected':
      return 'An earlier step failed, so this step was skipped.';
    case 'condition_rejected':
      return 'The step condition did not match, so this step was skipped.';
    case 'condition_errored':
      return 'The step condition could not be evaluated, so this step was skipped.';
    default:
      return 'This step did not run.';
  }
}

function skippedJobDescription(reason: SkipReason): string {
  switch (reason) {
    case 'dependency_not_completed':
    case 'default_gate_rejected':
      return 'A required job did not succeed, so this job was skipped.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The job condition did not match, so this job was skipped.';
    case 'condition_errored':
      return 'The job condition could not be evaluated, so this job was skipped.';
    default:
      return 'This job did not start.';
  }
}
