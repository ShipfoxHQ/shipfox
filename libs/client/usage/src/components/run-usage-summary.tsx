import {type ReactNode, useMemo} from 'react';
import {type RunUsage, summarizeRunUsage, usageQuantitiesFromTotals} from '#core/usage.js';
import {useUsageCosts} from './usage-cost.js';
import {UsageCostText} from './usage-cost-text.js';
import {UsageBreakdown} from './usage-details.js';

export interface RunUsageSummaryProps {
  runId: string;
  usage: RunUsage | undefined;
  className?: string | undefined;
  prefix?: ReactNode;
}

export function RunUsageSummary({runId, usage, className, prefix}: RunUsageSummaryProps) {
  const cost = useRunCost(runId, usage);
  if (!usage || !cost) return null;
  return (
    <>
      {prefix}
      <span data-usage-run-summary className={`inline-flex items-center ${className ?? ''}`}>
        <UsageCostText cost={cost} />
      </span>
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
  const pricingInputs = useMemo(
    () =>
      summary
        ? [
            {
              reference: {kind: 'run' as const, id: runId},
              ...(completeDuration
                ? {quantities: usageQuantitiesFromTotals(summary.totals, summary.computeSeconds)}
                : {}),
            },
          ]
        : [],
    [runId, summary, completeDuration],
  );
  const costs = useUsageCosts(pricingInputs);
  return costs.get(`run:${runId}`);
}
