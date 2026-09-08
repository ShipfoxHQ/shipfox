import {
  type UsagePricingEstimateModel,
  usagePricingReferenceKey,
  useUsagePricing,
} from '@shipfox/client-shell/runtime';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useMemo} from 'react';
import type {JobExecutionUsage} from '#core/usage.js';
import {
  groupInferenceSegmentsByStepAttempt,
  usageQuantitiesFromTotals,
  usageTokenTotalsForSegments,
} from '#core/usage.js';
import {usagePricingDisclosure, useUsageCosts} from './usage-cost.js';
import {UsageCostBadge} from './usage-cost-badge.js';
import {
  formatUsageCacheWrite,
  formatUsageNumber,
  formatUsageRate,
  usageTokenBreakdownTitle,
} from './usage-format.js';

export interface StepInferenceTableProps {
  usage: JobExecutionUsage | undefined;
  stepLabels?: ReadonlyMap<string, string> | undefined;
  stepAttemptLabels?: ReadonlyMap<string, string> | undefined;
  className?: string | undefined;
}

/** Inference quantities grouped by step attempt, model, and upstream provider. */
export function StepInferenceTable({
  usage,
  stepLabels,
  stepAttemptLabels,
  className,
}: StepInferenceTableProps) {
  const pricing = useUsagePricing();
  const rows = useMemo(
    () => (usage ? groupInferenceSegmentsByStepAttempt(usage.inferenceSegments) : []),
    [usage],
  );
  const quantitiesByStepAttempt = useMemo(() => {
    if (!usage) return new Map<string, ReturnType<typeof usageQuantitiesFromTotals>>();
    const segmentsByStepAttempt = new Map<string, typeof usage.inferenceSegments>();
    for (const segment of usage.inferenceSegments) {
      const segments = segmentsByStepAttempt.get(segment.stepAttemptId) ?? [];
      segments.push(segment);
      segmentsByStepAttempt.set(segment.stepAttemptId, segments);
    }
    return new Map(
      [...segmentsByStepAttempt].map(([stepAttemptId, segments]) => [
        stepAttemptId,
        usageQuantitiesFromTotals(usageTokenTotalsForSegments(segments), 0),
      ]),
    );
  }, [usage]);
  const modelsByStepAttempt = useMemo(() => {
    const grouped = new Map<string, UsagePricingEstimateModel[]>();
    for (const row of rows) {
      const models = grouped.get(row.stepAttemptId) ?? [];
      models.push({
        model: row.model,
        upstream: row.upstream,
        quantities: usageQuantitiesFromTotals(row, 0),
      });
      grouped.set(row.stepAttemptId, models);
    }
    return grouped;
  }, [rows]);
  const pricingInputs = useMemo(
    () =>
      rows.map((row) => ({
        reference: {
          kind: 'step-attempt' as const,
          id: row.stepAttemptId,
          model: row.model,
          upstream: row.upstream,
        },
        quantities:
          quantitiesByStepAttempt.get(row.stepAttemptId) ?? usageQuantitiesFromTotals(row, 0),
        models: modelsByStepAttempt.get(row.stepAttemptId) ?? [],
      })),
    [modelsByStepAttempt, quantitiesByStepAttempt, rows],
  );
  const costs = useUsageCosts(pricingInputs);

  if (rows.length === 0) return null;

  const estimatedCost = [...costs.values()].find((cost) => cost.state === 'estimated');
  const disclosure = usagePricingDisclosure(pricing, estimatedCost);
  const showCosts = pricing !== undefined && costs.size > 0;
  return (
    <Panel data-usage-step-inference-table className={className}>
      <PanelHeader>
        <div className="min-w-0">
          <PanelTitle>Inference usage</PanelTitle>
          <Text as="p" size="xs" className="mt-tight text-foreground-neutral-muted">
            Token classes and web searches recorded by step attempt, model, and provider.
          </Text>
        </div>
      </PanelHeader>
      <PanelBody className="p-0">
        <Table tabIndex={0} aria-label="Inference usage" className="focus-visible:outline-auto">
          <TableHeader>
            <TableRow>
              <TableHead>Step attempt</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead className="text-right">Cached input</TableHead>
              <TableHead className="text-right">Cache write</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Cache hit</TableHead>
              <TableHead className="text-right">Web searches</TableHead>
              {showCosts ? <TableHead className="text-right">Cost</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const referenceKey = usagePricingReferenceKey({
                kind: 'step-attempt',
                id: row.stepAttemptId,
                model: row.model,
                upstream: row.upstream,
              });
              const cost = costs.get(referenceKey);
              const tokenDetailsTitle = usageTokenBreakdownTitle(row);
              return (
                <TableRow key={JSON.stringify([row.stepAttemptId, row.upstream, row.model])}>
                  <TableCell>
                    <Text as="span" size="xs" className="block truncate">
                      {stepLabels?.get(row.stepId) ?? shortIdentifier(row.stepId)}
                    </Text>
                    <Code as="span" variant="label" className="text-foreground-neutral-muted">
                      attempt{' '}
                      {stepAttemptLabels?.get(row.stepAttemptId) ??
                        shortIdentifier(row.stepAttemptId)}
                    </Code>
                  </TableCell>
                  <TableCell>
                    <Code as="span" variant="label">
                      {row.upstream}
                    </Code>
                  </TableCell>
                  <TableCell>
                    <Code as="span" variant="label">
                      {row.model}
                    </Code>
                  </TableCell>
                  <TableCell className="text-right font-code tabular-nums">
                    {formatUsageNumber(row.requestCount)}
                  </TableCell>
                  <TableCell
                    className="text-right font-code tabular-nums"
                    title={tokenDetailsTitle}
                  >
                    {formatUsageNumber(row.inputTokens)}
                  </TableCell>
                  <TableCell
                    className="text-right font-code tabular-nums"
                    title={tokenDetailsTitle}
                  >
                    {formatUsageNumber(row.cachedInputTokens)}
                  </TableCell>
                  <TableCell
                    className="text-right font-code tabular-nums"
                    title={tokenDetailsTitle}
                  >
                    {formatUsageCacheWrite(row)}
                  </TableCell>
                  <TableCell
                    className="text-right font-code tabular-nums"
                    title={tokenDetailsTitle}
                  >
                    {formatUsageNumber(row.outputTokens)}
                  </TableCell>
                  <TableCell
                    className="text-right font-code tabular-nums"
                    title={tokenDetailsTitle}
                  >
                    {formatUsageNumber(row.totalTokens)}
                  </TableCell>
                  <TableCell
                    className="text-right font-code tabular-nums"
                    title={tokenDetailsTitle}
                  >
                    {formatUsageRate(row.cacheHitRate)}
                  </TableCell>
                  <TableCell
                    className="text-right font-code tabular-nums"
                    title={tokenDetailsTitle}
                  >
                    {formatUsageNumber(row.webSearchRequests)}
                  </TableCell>
                  {showCosts ? (
                    <TableCell
                      className="text-right align-middle"
                      title="Cost for this step attempt model"
                    >
                      <span className="inline-flex min-w-64 flex-col items-end justify-center gap-2">
                        <UsageCostBadge cost={cost} />
                        {!cost ? (
                          <Code as="span" variant="label" className="text-foreground-neutral-muted">
                            —
                          </Code>
                        ) : null}
                        <span className="sr-only">Step attempt model cost</span>
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </PanelBody>
      {disclosure ? (
        <Text
          as="p"
          data-usage-pricing-disclosure
          size="xs"
          className="border-t border-border-neutral-base px-panel-compact py-row text-foreground-neutral-subtle"
        >
          {disclosure}
        </Text>
      ) : null}
    </Panel>
  );
}

function shortIdentifier(identifier: string): string {
  return identifier.slice(0, 8);
}
