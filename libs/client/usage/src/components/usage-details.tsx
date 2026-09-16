import {
  type UsagePricingCost,
  type UsagePricingModel,
  useUsagePricing,
} from '@shipfox/client-shell/runtime';
import {useMemo} from 'react';
import {groupUsageByModel, type RunUsage, type UsageTokenTotals} from '#core/usage.js';
import {formatUsageCost} from './usage-cost.js';
import {formatUsageDuration, formatUsageNumber, formatUsageRate} from './usage-format.js';

interface UsageDetailsProps {
  usage: RunUsage;
  cost: UsagePricingCost | undefined;
}

export function UsageBreakdown({usage, cost}: UsageDetailsProps) {
  const pricing = useUsagePricing();
  const showPrices = Boolean(formatUsageCost(pricing, cost));
  const recordedModels = useMemo(
    () => groupUsageByModel(usage.inferenceSegments),
    [usage.inferenceSegments],
  );
  const models: {model: string; totals: UsageTokenTotals | undefined}[] = [...recordedModels];
  for (const priced of cost?.breakdown?.models ?? []) {
    if (!models.some((model) => model.model === priced.model)) {
      models.push({model: priced.model, totals: undefined});
    }
  }
  const durationKnown =
    usage.jobExecutions.length > 0 &&
    usage.jobExecutions.every((job) => job.durationSeconds !== null);
  const duration = usage.jobExecutions.reduce(
    (total, job) => total + (job.durationSeconds ?? 0),
    0,
  );

  return (
    <div className="w-full min-w-0 text-sm text-foreground-neutral-base">
      {showPrices ? (
        <div className="flex items-center justify-between gap-inline pb-cluster">
          <span className="font-medium">Total cost</span>
          <CostValue cost={cost} />
        </div>
      ) : null}
      {cost && !cost.breakdown ? (
        <p className="pb-cluster text-xs text-foreground-neutral-subtle">
          Cost breakdown unavailable. Recorded usage is shown below.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-cluster border-t border-border-neutral-base py-row">
        <div>
          <h3 className="font-medium">Machine</h3>
          <p className="text-xs text-foreground-neutral-subtle">
            {durationKnown ? formatUsageDuration(duration) : 'Duration unavailable'}
          </p>
        </div>
        {showPrices ? <CostValue cost={cost?.breakdown?.machine} /> : null}
      </div>
      <details className="border-t border-border-neutral-base">
        <summary className={SUMMARY_CLASS}>
          <span className="flex min-w-0 flex-1 items-center justify-between gap-inline">
            <span className="font-medium">Model usage</span>
            {showPrices ? <CostValue cost={cost?.breakdown?.modelUsage} /> : null}
          </span>
        </summary>
        {models.length === 0 ? (
          <p className="pb-row text-xs text-foreground-neutral-subtle">No model usage recorded.</p>
        ) : (
          models.map((model) => (
            <ModelUsage
              key={model.model}
              model={model.model}
              totals={model.totals}
              showPrices={showPrices}
              pricing={cost?.breakdown?.models.find((priced) => priced.model === model.model)}
            />
          ))
        )}
      </details>
    </div>
  );
}

function ModelUsage({
  model,
  totals,
  pricing,
  showPrices,
}: {
  model: string;
  totals: UsageTokenTotals | undefined;
  pricing: UsagePricingModel | undefined;
  showPrices: boolean;
}) {
  return (
    <details className="ml-cluster border-t border-border-neutral-base">
      <summary className={SUMMARY_CLASS}>
        <span className="flex min-w-0 flex-1 items-center justify-between gap-inline">
          <span className="min-w-0 break-words font-code text-xs">{model}</span>
          {showPrices ? <CostValue cost={pricing?.cost} /> : null}
        </span>
      </summary>
      {pricing ? (
        <dl className="pb-row">
          {pricing.skus.map((sku) => (
            <div key={sku.sku} className="flex items-start justify-between gap-cluster py-tight">
              <dt className="min-w-0">
                <span>{sku.label}</span>
                <span className="block break-words text-xs text-foreground-neutral-subtle">
                  {formatUsageNumber(sku.quantity)} {sku.unit} · {sku.rate}
                </span>
              </dt>
              <dd>
                <CostValue cost={sku.cost} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!pricing && totals ? <TokenQuantities totals={totals} /> : null}
      {totals ? (
        <details className="pb-row">
          <summary className="cursor-pointer text-xs text-foreground-neutral-subtle focus-visible:outline-auto">
            Request details
          </summary>
          <dl className="pt-tight text-xs text-foreground-neutral-subtle">
            <Quantity label="Requests" value={formatUsageNumber(totals.requestCount)} />
            <Quantity label="Cache hit" value={formatUsageRate(totals.cacheHitRate)} />
            <Quantity
              label="Reasoning tokens (included in output)"
              value={formatUsageNumber(totals.reasoningTokens)}
            />
          </dl>
        </details>
      ) : null}
    </details>
  );
}

function TokenQuantities({totals}: {totals: UsageTokenTotals}) {
  return (
    <div className="pb-row">
      <p className="pb-tight text-xs text-foreground-neutral-subtle">SKU pricing unavailable.</p>
      <dl className="text-xs">
        <Quantity label="Input tokens" value={formatUsageNumber(totals.inputTokens)} />
        <Quantity label="Cached input tokens" value={formatUsageNumber(totals.cachedInputTokens)} />
        <Quantity label="Cache write tokens" value={formatUsageNumber(totals.cacheWriteTokens)} />
        <Quantity label="Output tokens" value={formatUsageNumber(totals.outputTokens)} />
        {totals.webSearchRequests > 0 ? (
          <Quantity label="Web searches" value={formatUsageNumber(totals.webSearchRequests)} />
        ) : null}
      </dl>
    </div>
  );
}

function Quantity({label, value}: {label: string; value: string}) {
  return (
    <div className="flex justify-between gap-inline py-tight">
      <dt>{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}

function CostValue({cost}: {cost: UsagePricingCost | undefined}) {
  const pricing = useUsagePricing();
  const formatted = formatUsageCost(pricing, cost);
  return (
    <span className="shrink-0 text-xs tabular-nums text-foreground-neutral-subtle">
      {formatted ? `${cost?.state === 'estimated' ? 'Est. ' : ''}${formatted}` : 'Unavailable'}
    </span>
  );
}

const SUMMARY_CLASS =
  'cursor-pointer py-row marker:text-foreground-neutral-muted focus-visible:outline-auto [&>span]:inline-flex [&>span]:w-[calc(100%-20px)] [&>span]:align-top';
