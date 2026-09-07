import {useMemo} from 'react';
import {
  type JobExecutionUsage,
  usageQuantitiesFromTotals,
  usageTokenTotalsForSegments,
} from '#core/usage.js';
import {useUsageCosts} from './usage-cost.js';
import {UsageDetails} from './usage-details.js';

export interface JobUsageCellsProps {
  usage: JobExecutionUsage | undefined;
  className?: string | undefined;
  stepLabels?: ReadonlyMap<string, string> | undefined;
  stepAttemptLabels?: ReadonlyMap<string, string> | undefined;
}

export function JobUsageCells({
  usage,
  className,
  stepLabels,
  stepAttemptLabels,
}: JobUsageCellsProps) {
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
  if (!usage || !runUsage) return null;

  return (
    <span data-usage-job-cells className={className}>
      <UsageDetails
        scope="Job"
        usage={runUsage}
        cost={costs.get(`job-execution:${usage.jobExecution.jobExecutionId}`)}
        stepLabels={stepLabels}
        stepAttemptLabels={stepAttemptLabels}
      />
    </span>
  );
}
