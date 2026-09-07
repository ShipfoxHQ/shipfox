import {useMemo} from 'react';
import {type RunUsage, summarizeRunUsage, usageQuantitiesFromTotals} from '#core/usage.js';
import {useUsageCosts} from './usage-cost.js';
import {UsageDetails} from './usage-details.js';

export interface RunUsageSummaryProps {
  runId: string;
  usage: RunUsage | undefined;
  className?: string | undefined;
}

export function RunUsageSummary({runId, usage, className}: RunUsageSummaryProps) {
  const summary = useMemo(() => (usage ? summarizeRunUsage(usage) : undefined), [usage]);
  const completeDuration = usage?.jobExecutions.every((job) => job.durationSeconds !== null);
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
  if (!usage) return null;

  return (
    <span data-usage-run-summary className={className}>
      <UsageDetails scope="Run" usage={usage} cost={costs.get(`run:${runId}`)} />
    </span>
  );
}
