import type {UsageTokenTotals} from '#core/usage.js';

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const exactNumberFormatter = new Intl.NumberFormat('en-US');

export function formatUsageNumber(value: number): string {
  return compactNumberFormatter.format(value);
}

export function formatExactUsageNumber(value: number): string {
  return exactNumberFormatter.format(value);
}

export function formatUsageDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const totalSeconds = Math.round(seconds);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function usageQuantitiesFromTotals(totals: UsageTokenTotals, computeSeconds = 0) {
  return {
    computeSeconds,
    requestCount: totals.requestCount,
    inputTokens: totals.inputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    outputTokens: totals.outputTokens,
    webSearchRequests: totals.webSearchRequests,
  };
}

export function formatUsageRate(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 1) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatUsageCacheWrite(totals: UsageTokenTotals): string {
  const isReported = totals.reportedTokenCounts.some(
    ({dialect}) => dialect === 'anthropic-messages',
  );
  return isReported ? formatUsageNumber(totals.cacheWriteTokens) : '—';
}

export function usageTokenBreakdownTitle(totals: UsageTokenTotals): string {
  const derived = [
    `Input ${formatExactUsageNumber(totals.inputTokens)}`,
    `Cached input ${formatExactUsageNumber(totals.cachedInputTokens)}`,
    `Cache write ${formatExactUsageNumber(totals.cacheWriteTokens)}`,
    `Output ${formatExactUsageNumber(totals.outputTokens)}`,
    `Cache hit ${formatUsageRate(totals.cacheHitRate)}`,
  ].join(' · ');
  const reported = totals.reportedTokenCounts
    .map(
      (counts) =>
        `${counts.dialect}: input ${formatExactUsageNumber(counts.inputTokens)}, output ${formatExactUsageNumber(counts.outputTokens)}, cache write ${formatExactUsageNumber(counts.cacheCreationTokens)}, cache read ${formatExactUsageNumber(counts.cacheReadTokens)}, reasoning ${formatExactUsageNumber(counts.reasoningTokens)}, web searches ${formatExactUsageNumber(counts.webSearchRequests)}`,
    )
    .join('; ');
  return reported ? `${derived} · As reported: ${reported}` : derived;
}
