import {usagePricingReferenceKey} from '@shipfox/client-shell/runtime';
import {useMemo} from 'react';
import {
  groupUsageByModel,
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
}

export function JobUsageCells({usage, className}: JobUsageCellsProps) {
  const {cost} = useJobCost(usage);
  if (!usage || !cost) return null;
  return (
    <span data-usage-job-cells className={`inline-flex items-center ${className ?? ''}`}>
      <UsageCostText cost={cost} />
    </span>
  );
}

export function JobUsageBreakdown({usage}: JobUsageCellsProps) {
  const {runUsage, cost} = useJobCost(usage);
  if (!runUsage)
    return (
      <p className="text-xs text-foreground-neutral-muted">Usage is not available for this job.</p>
    );
  return <UsageBreakdown usage={runUsage} cost={cost} />;
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
    const totals = usageTokenTotalsForSegments(usage.inferenceSegments);
    return [
      {
        reference: {
          workspaceId: jobExecution.workspaceId,
          kind: 'job-execution' as const,
          id: jobExecution.jobExecutionId,
        },
        ...(jobExecution.durationSeconds === null
          ? {}
          : {
              quantities: usageQuantitiesFromTotals(totals, jobExecution.durationSeconds),
              compute: [
                {
                  jobExecutionId: jobExecution.jobExecutionId,
                  runnerLabels: jobExecution.runnerLabels ?? [],
                  templateKey: jobExecution.templateKey,
                  seconds: jobExecution.durationSeconds,
                },
              ],
            }),
        models: groupUsageByModel(usage.inferenceSegments).map(({model, totals: modelTotals}) => ({
          model,
          quantities: usageQuantitiesFromTotals(modelTotals),
        })),
      },
    ];
  }, [usage]);
  const costs = useUsageCosts(pricingInputs);
  return {
    runUsage,
    cost: usage
      ? costs.get(
          usagePricingReferenceKey({
            workspaceId: usage.jobExecution.workspaceId,
            kind: 'job-execution',
            id: usage.jobExecution.jobExecutionId,
          }),
        )
      : undefined,
  };
}
