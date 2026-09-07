import type {UsageTokenTotals} from '#core/usage.js';

const numberFormatter = new Intl.NumberFormat('en-US');

export function formatUsageNumber(value: number): string {
  return numberFormatter.format(value);
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
    `Input ${formatUsageNumber(totals.inputTokens)}`,
    `Cached input ${formatUsageNumber(totals.cachedInputTokens)}`,
    `Cache write ${formatUsageNumber(totals.cacheWriteTokens)}`,
    `Output ${formatUsageNumber(totals.outputTokens)}`,
    `Cache hit ${formatUsageRate(totals.cacheHitRate)}`,
  ].join(' · ');
  const reported = totals.reportedTokenCounts
    .map(
      (counts) =>
        `${counts.dialect}: input ${formatUsageNumber(counts.inputTokens)}, output ${formatUsageNumber(counts.outputTokens)}, cache write ${formatUsageNumber(counts.cacheCreationTokens)}, cache read ${formatUsageNumber(counts.cacheReadTokens)}, reasoning ${formatUsageNumber(counts.reasoningTokens)}, web searches ${formatUsageNumber(counts.webSearchRequests)}`,
    )
    .join('; ');
  return reported ? `${derived} · As reported: ${reported}` : derived;
}
