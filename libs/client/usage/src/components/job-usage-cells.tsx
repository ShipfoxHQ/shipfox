import {useMemo} from 'react';
import {
  type JobExecutionUsage,
  usageQuantitiesFromTotals,
  usageTokenTotalsForSegments,
} from '#core/usage.js';
import {useUsageCosts} from './usage-cost.js';
import {UsageCostText} from './usage-cost-text.js';
import {UsageBreakdown} from './usage-details.js';

export interface JobUsageCellsProps {
  usage: JobExecutionUsage | undefined;
  className?: string | undefined;
  stepLabels?: ReadonlyMap<string, string> | undefined;
  stepAttemptLabels?: ReadonlyMap<string, string> | undefined;
}

export function JobUsageCells({usage, className}: JobUsageCellsProps) {
  const {cost} = useJobCost(usage);
  if (!usage) return null;
  return (
    <span data-usage-job-cells className={`inline-flex items-center ${className ?? ''}`}>
      <UsageCostText cost={cost} />
    </span>
  );
}

export function JobUsageBreakdown({usage, stepLabels, stepAttemptLabels}: JobUsageCellsProps) {
  const {runUsage, cost} = useJobCost(usage);
  if (!runUsage)
    return (
      <p className="text-xs text-foreground-neutral-muted">Usage is not available for this job.</p>
    );
  return (
    <UsageBreakdown
      usage={runUsage}
      cost={cost}
      stepLabels={stepLabels}
      stepAttemptLabels={stepAttemptLabels}
    />
  );
}

function useJobCost(usage: JobExecutionUsage | undefined) {
  const runUsage = useMemo(
    () =>
      usage
        ? {
            jobExecutions: [usage.jobExecution],
            inferenceSegments: usage.inferenceSegments,
          }
        : undefined,
    [usage],
  );
  const pricingInputs = useMemo(() => {
    if (!usage) return [];
    const {jobExecution} = usage;
    return [
      {
        reference: {kind: 'job-execution' as const, id: jobExecution.jobExecutionId},
        ...(jobExecution.durationSeconds === null
          ? {}
          : {
              quantities: usageQuantitiesFromTotals(
                usageTokenTotalsForSegments(usage.inferenceSegments),
                jobExecution.durationSeconds,
              ),
            }),
      },
    ];
  }, [usage]);
  const costs = useUsageCosts(pricingInputs);
  return {
    runUsage,
    cost: usage ? costs.get(`job-execution:${usage.jobExecution.jobExecutionId}`) : undefined,
  };
}
