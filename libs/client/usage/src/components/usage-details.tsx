import {
  type UsagePricingCost,
  type UsagePricingModel,
  useUsagePricing,
} from '@shipfox/client-shell/runtime';
import {Badge} from '@shipfox/react-ui/badge';
import {
  InspectorSection,
  InspectorSectionEmpty,
  PropertyList,
  PropertyRow,
} from '@shipfox/react-ui/inspector';
import {Text} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import {groupUsageByModel, type RunUsage, type UsageTokenTotals} from '#core/usage.js';
import {formatUsageCost} from './usage-cost.js';
import {formatUsageDuration, formatUsageNumber, formatUsageRate} from './usage-format.js';

interface UsageDetailsProps {
  usage: RunUsage;
  cost: UsagePricingCost | undefined;
}

interface ModelUsageInfo {
  model: string;
  totals: UsageTokenTotals | undefined;
  pricing: UsagePricingModel | undefined;
}

export function UsageBreakdown({usage, cost}: UsageDetailsProps) {
  const pricing = useUsagePricing();
  const showPrices = Boolean(formatUsageCost(pricing, cost));
  const recordedModels = useMemo(
    () => groupUsageByModel(usage.inferenceSegments),
    [usage.inferenceSegments],
  );
  const models: ModelUsageInfo[] = recordedModels.map(({model, totals}) => ({
    model,
    totals,
    pricing: cost?.breakdown?.models.find((priced) => priced.model === model),
  }));
  for (const priced of cost?.breakdown?.models ?? []) {
    if (!models.some((model) => model.model === priced.model)) {
      models.push({model: priced.model, totals: undefined, pricing: priced});
    }
  }
  const detailedModels = models.filter(({totals, pricing}) => totals || pricing?.skus.length);
  const durationKnown =
    usage.jobExecutions.length > 0 &&
    usage.jobExecutions.every((job) => job.durationSeconds !== null);
  const duration = usage.jobExecutions.reduce(
    (total, job) => total + (job.durationSeconds ?? 0),
    0,
  );

  return (
    <>
      {cost && !cost.breakdown ? (
        <div className="px-panel-compact py-row">
          <Text size="xs" className="text-foreground-neutral-muted">
            Cost breakdown unavailable. Recorded usage is shown below.
          </Text>
        </div>
      ) : null}
      <InspectorSection
        title="Machine"
        aside={
          showPrices && cost?.breakdown?.machine ? (
            <CostValue cost={cost.breakdown.machine} />
          ) : null
        }
      >
        <PropertyList>
          <PropertyRow label="Duration">
            {durationKnown ? formatUsageDuration(duration) : 'Duration unavailable'}
          </PropertyRow>
        </PropertyList>
      </InspectorSection>
      <InspectorSection
        title="Models"
        count={models.length || undefined}
        aside={
          showPrices && cost?.breakdown?.modelUsage ? (
            <CostValue cost={cost.breakdown.modelUsage} />
          ) : null
        }
      >
        {models.length === 0 ? (
          <InspectorSectionEmpty>No model usage recorded.</InspectorSectionEmpty>
        ) : (
          <PropertyList>
            {models.map((model) => (
              <PropertyRow
                key={model.model}
                label={model.model}
                labelFont="code"
                meta={
                  showPrices && model.pricing?.cost ? <CostValue cost={model.pricing.cost} /> : null
                }
              >
                {model.totals ? tokenSummary(model.totals) : 'No recorded tokens'}
              </PropertyRow>
            ))}
          </PropertyList>
        )}
      </InspectorSection>
      {detailedModels.length > 0 ? (
        <InspectorSection title="Pricing and request details" defaultOpen={false}>
          {detailedModels.map((model) => (
            <ModelUsageDetails key={model.model} {...model} />
          ))}
        </InspectorSection>
      ) : null}
    </>
  );
}

function tokenSummary(totals: UsageTokenTotals): string {
  return [
    `${formatUsageNumber(totals.inputTokens)} input`,
    totals.cachedInputTokens > 0 ? `${formatUsageNumber(totals.cachedInputTokens)} cached` : null,
    totals.cacheWriteTokens > 0
      ? `${formatUsageNumber(totals.cacheWriteTokens)} cache write`
      : null,
    `${formatUsageNumber(totals.outputTokens)} output`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function ModelUsageDetails({model, totals, pricing}: ModelUsageInfo) {
  const skus = pricing?.skus ?? [];
  return (
    <InspectorSection
      title={<span className="font-code">{model}</span>}
      aside={skus.length === 0 && totals ? <Badge size="2xs">SKU pricing unavailable</Badge> : null}
    >
      <PropertyList>
        {skus.map((sku) => (
          <PropertyRow key={sku.sku} label={sku.label} meta={<CostValue cost={sku.cost} />}>
            {formatUsageNumber(sku.quantity)} {sku.unit} · {sku.rate}
          </PropertyRow>
        ))}
        {skus.length === 0 && totals ? <TokenQuantities totals={totals} /> : null}
        {totals ? (
          <>
            <PropertyRow label="Requests">{formatUsageNumber(totals.requestCount)}</PropertyRow>
            <PropertyRow label="Cache hit">{formatUsageRate(totals.cacheHitRate)}</PropertyRow>
            <PropertyRow label="Reasoning tokens (included in output)">
              {formatUsageNumber(totals.reasoningTokens)}
            </PropertyRow>
          </>
        ) : null}
      </PropertyList>
    </InspectorSection>
  );
}

function TokenQuantities({totals}: {totals: UsageTokenTotals}) {
  return (
    <>
      <PropertyRow label="Input tokens">{formatUsageNumber(totals.inputTokens)}</PropertyRow>
      <PropertyRow label="Cached input tokens">
        {formatUsageNumber(totals.cachedInputTokens)}
      </PropertyRow>
      <PropertyRow label="Cache write tokens">
        {formatUsageNumber(totals.cacheWriteTokens)}
      </PropertyRow>
      <PropertyRow label="Output tokens">{formatUsageNumber(totals.outputTokens)}</PropertyRow>
      {totals.webSearchRequests > 0 ? (
        <PropertyRow label="Web searches">
          {formatUsageNumber(totals.webSearchRequests)}
        </PropertyRow>
      ) : null}
    </>
  );
}

function CostValue({cost}: {cost: UsagePricingCost | undefined}) {
  const pricing = useUsagePricing();
  const formatted = formatUsageCost(pricing, cost);
  return (
    <span className="shrink-0 font-code text-xs tabular-nums text-foreground-neutral-base">
      {formatted ?? 'Unavailable'}
    </span>
  );
}
