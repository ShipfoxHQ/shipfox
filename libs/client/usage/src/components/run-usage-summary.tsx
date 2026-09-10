import {usagePricingReferenceKey, useUsagePricing} from '@shipfox/client-shell/runtime';
import {type ReactNode, useMemo} from 'react';
import {
  groupUsageByModel,
  type RunUsage,
  summarizeRunUsage,
  usageQuantitiesFromTotals,
} from '#core/usage.js';
import {usagePricingDisclosure, useUsageCosts} from './usage-cost.js';
import {UsageCostText} from './usage-cost-text.js';
import {UsageBreakdown} from './usage-details.js';

export interface RunUsageSummaryProps {
  runId: string;
  usage: RunUsage | undefined;
  className?: string | undefined;
  prefix?: ReactNode;
}

export function RunUsageSummary({runId, usage, className, prefix}: RunUsageSummaryProps) {
  const pricing = useUsagePricing();
  const cost = useRunCost(runId, usage);
  const disclosure = usagePricingDisclosure(pricing, cost);
  if (!usage || !cost) return null;
  return (
    <>
      {prefix}
      <span data-usage-run-summary className={`inline-flex items-center ${className ?? ''}`}>
        <UsageCostText cost={cost} />
      </span>
      {disclosure ? (
        <span
          data-usage-pricing-disclosure
          className="ml-tight text-xs text-foreground-neutral-subtle"
        >
          {disclosure}
        </span>
      ) : null}
    </>
  );
}

export function RunUsageBreakdown({runId, usage}: RunUsageSummaryProps) {
  const cost = useRunCost(runId, usage);
  if (!usage) return null;
  return <UsageBreakdown usage={usage} cost={cost} />;
}

function useRunCost(runId: string, usage: RunUsage | undefined) {
  const summary = useMemo(() => (usage ? summarizeRunUsage(usage) : undefined), [usage]);
  const completeDuration =
    Boolean(usage?.jobExecutions.length) &&
    usage?.jobExecutions.every((job) => job.durationSeconds !== null);
  const workspaceId =
    usage?.jobExecutions[0]?.workspaceId ?? usage?.inferenceSegments[0]?.workspaceId;
  const pricingInputs = useMemo(
    () =>
      summary && usage && workspaceId
        ? [
            {
              reference: {workspaceId, kind: 'run' as const, id: runId},
              ...(completeDuration
                ? {
                    quantities: usageQuantitiesFromTotals(summary.totals, summary.computeSeconds),
                    compute: usage.jobExecutions.map((job) => ({
                      jobExecutionId: job.jobExecutionId,
                      runnerLabels: job.runnerLabels ?? [],
                      templateKey: job.templateKey,
                      seconds: job.durationSeconds ?? 0,
                    })),
                  }
                : {}),
              models: groupUsageByModel(usage.inferenceSegments).map(
                ({model, upstream, totals}) => ({
                  model,
                  upstream,
                  quantities: usageQuantitiesFromTotals(totals),
                }),
              ),
            },
          ]
        : [],
    [runId, summary, usage, completeDuration, workspaceId],
  );
  const costs = useUsageCosts(pricingInputs);
  return workspaceId
    ? costs.get(usagePricingReferenceKey({workspaceId, kind: 'run', id: runId}))
    : undefined;
}
