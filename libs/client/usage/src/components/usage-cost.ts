import {
  type ClientUsagePricing,
  type UsagePricingCost,
  type UsagePricingEstimateCompute,
  type UsagePricingEstimateModel,
  type UsagePricingQuantities,
  type UsagePricingReference,
  type UsagePricingResolution,
  usagePricingReferenceKey,
  useUsagePricing,
} from '@shipfox/client-shell/runtime';
import {useEffect, useRef, useState} from 'react';

export interface UsageCostRequest {
  reference: UsagePricingReference;
  quantities?: UsagePricingQuantities;
  compute?: readonly UsagePricingEstimateCompute[];
  models?: readonly UsagePricingEstimateModel[];
}

interface ActiveCostRequest {
  consumers: number;
  result: Promise<ReadonlyMap<string, UsagePricingCost>>;
}

// Share a snapshot only while its consumers are mounted, within one pricing provider.
const activeCostRequests = new WeakMap<ClientUsagePricing, Map<string, ActiveCostRequest>>();

export function useUsageCosts(
  inputs: readonly UsageCostRequest[],
): ReadonlyMap<string, UsagePricingCost> {
  const pricing = useUsagePricing();
  const requestSignature = usageCostRequestSignature(inputs);
  const requestsCache = useRef<{signature: string; requests: UsageCostRequest[]}>({
    signature: '',
    requests: [],
  });
  if (requestsCache.current.signature !== requestSignature) {
    requestsCache.current = {
      signature: requestSignature,
      requests: inputs.map((input) => ({...input})),
    };
  }
  const requests = requestsCache.current.requests;
  const [costs, setCosts] = useState<ReadonlyMap<string, UsagePricingCost>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    if (!pricing || requests.length === 0) {
      setCosts(new Map());
      return () => {
        cancelled = true;
      };
    }

    setCosts(new Map());
    let activeRequests = activeCostRequests.get(pricing);
    if (!activeRequests) {
      activeRequests = new Map();
      activeCostRequests.set(pricing, activeRequests);
    }
    const signature = usageCostRequestSignature(requests);
    let activeRequest = activeRequests.get(signature);
    if (!activeRequest) {
      activeRequest = {consumers: 0, result: loadUsageCosts({pricing, requests})};
      activeRequests.set(signature, activeRequest);
    }
    activeRequest.consumers += 1;
    void activeRequest.result.then((nextCosts) => {
      if (!cancelled) setCosts(nextCosts);
    });

    return () => {
      cancelled = true;
      activeRequest.consumers -= 1;
      if (activeRequest.consumers === 0) activeRequests.delete(signature);
    };
  }, [pricing, requests]);

  return costs;
}

export function usagePricingCostFromResolution(
  resolution: UsagePricingResolution,
  reference: UsagePricingReference,
): UsagePricingCost | undefined {
  const key = usagePricingReferenceKey(reference);
  let candidate: UsagePricingCost | null | undefined;
  if (Array.isArray(resolution)) {
    candidate = resolution.find(
      (item) =>
        item.workspaceId === reference.workspaceId &&
        item.kind === reference.kind &&
        item.id === reference.id &&
        item.model === reference.model &&
        item.upstream === reference.upstream,
    );
  } else if (isMapLike(resolution)) {
    candidate = resolution.get(key);
  } else {
    const record = resolution as Readonly<Record<string, UsagePricingCost | null | undefined>>;
    candidate = record[key];
  }

  return validUsagePricingCost(candidate) ? candidate : undefined;
}

export function formatUsageCost(
  pricing: ClientUsagePricing | undefined,
  cost: UsagePricingCost | undefined,
): string | undefined {
  if (!pricing || !validUsagePricingCost(cost)) return undefined;
  try {
    const formatted = pricing.formatMoney(cost.amount);
    return formatted || undefined;
  } catch {
    return undefined;
  }
}

export function usagePricingDisclosure(
  pricing: ClientUsagePricing | undefined,
  cost: UsagePricingCost | undefined,
): string | undefined {
  if (cost?.state !== 'estimated') return undefined;
  return pricing?.disclosure || undefined;
}

async function loadUsageCosts({
  pricing,
  requests,
}: {
  pricing: ClientUsagePricing;
  requests: readonly UsageCostRequest[];
}): Promise<ReadonlyMap<string, UsagePricingCost>> {
  const references = uniqueReferences(requests.map(({reference}) => reference));
  let resolution: UsagePricingResolution = new Map();
  try {
    resolution = await pricing.resolveCosts(references);
  } catch {
    resolution = new Map();
  }

  const costs = new Map<string, UsagePricingCost>();
  const missing = collectMissingUsageCosts(requests, resolution, costs);
  await Promise.all(
    [...missing.values()].map(async (request) => {
      const estimate = await estimateUsageCost(pricing, request);
      if (estimate) costs.set(usagePricingReferenceKey(request.reference), estimate);
    }),
  );
  return costs;
}

function collectMissingUsageCosts(
  requests: readonly UsageCostRequest[],
  resolution: UsagePricingResolution,
  costs: Map<string, UsagePricingCost>,
): Map<string, UsageCostRequest> {
  const missing = new Map<string, UsageCostRequest>();
  for (const request of requests) {
    const {reference} = request;
    const key = usagePricingReferenceKey(reference);
    const cost = usagePricingCostFromResolution(resolution, reference);
    if (cost) {
      costs.set(key, cost);
      continue;
    }
    const missingRequest = mergeMissingUsageRequest(missing.get(key), request);
    if (missingRequest) missing.set(key, missingRequest);
  }
  return missing;
}

function mergeMissingUsageRequest(
  current: UsageCostRequest | undefined,
  request: UsageCostRequest,
): UsageCostRequest | undefined {
  if (!request.quantities) return undefined;
  if (!current) return request;
  const compute = mergeComputeInputs(current.compute, request.compute);
  const models = mergeModelInputs(current.models, request.models);
  return {
    ...request,
    quantities: addUsagePricingQuantities(
      current.quantities ?? request.quantities,
      request.quantities,
    ),
    ...(compute !== undefined ? {compute} : {}),
    ...(models !== undefined ? {models} : {}),
  };
}

async function estimateUsageCost(
  pricing: ClientUsagePricing,
  request: UsageCostRequest,
): Promise<UsagePricingCost | undefined> {
  if (!request.quantities) return undefined;
  try {
    const estimate = await pricing.estimate({
      reference: request.reference,
      quantities: request.quantities,
      ...(request.compute ? {compute: request.compute} : {}),
      ...(request.models ? {models: request.models} : {}),
    });
    return validUsagePricingCost(estimate) ? estimate : undefined;
  } catch {
    // A pricing failure is an absent cost, so quantity-only views remain usable.
    return undefined;
  }
}

function usageCostRequestSignature(inputs: readonly UsageCostRequest[]): string {
  return JSON.stringify(
    inputs.map(({reference, quantities, compute, models}) => [
      reference.workspaceId,
      reference.kind,
      reference.id,
      reference.model ?? null,
      reference.upstream ?? null,
      quantities?.computeSeconds ?? null,
      quantities?.requestCount ?? null,
      quantities?.inputTokens ?? null,
      quantities?.cachedInputTokens ?? null,
      quantities?.cacheWriteTokens ?? null,
      quantities?.outputTokens ?? null,
      quantities?.webSearchRequests ?? null,
      compute ?? null,
      models ?? null,
    ]),
  );
}

function addUsagePricingQuantities(
  left: UsagePricingQuantities,
  right: UsagePricingQuantities,
): UsagePricingQuantities {
  return {
    computeSeconds: left.computeSeconds + right.computeSeconds,
    requestCount: left.requestCount + right.requestCount,
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    webSearchRequests: left.webSearchRequests + right.webSearchRequests,
  };
}

function mergeComputeInputs(
  left: readonly UsagePricingEstimateCompute[] | undefined,
  right: readonly UsagePricingEstimateCompute[] | undefined,
): readonly UsagePricingEstimateCompute[] | undefined {
  if (left === undefined && right === undefined) return undefined;
  const byExecutionId = new Map<string, UsagePricingEstimateCompute>();
  for (const input of [...(left ?? []), ...(right ?? [])]) {
    const current = byExecutionId.get(input.jobExecutionId);
    byExecutionId.set(
      input.jobExecutionId,
      current ? {...current, seconds: current.seconds + input.seconds} : input,
    );
  }
  return [...byExecutionId.values()];
}

function mergeModelInputs(
  left: readonly UsagePricingEstimateModel[] | undefined,
  right: readonly UsagePricingEstimateModel[] | undefined,
): readonly UsagePricingEstimateModel[] | undefined {
  if (left === undefined && right === undefined) return undefined;
  const byModel = new Map<string, UsagePricingEstimateModel>();
  for (const input of [...(left ?? []), ...(right ?? [])]) {
    const key = JSON.stringify([input.model, input.upstream]);
    const current = byModel.get(key);
    byModel.set(
      key,
      current
        ? {
            ...input,
            quantities: addUsagePricingQuantities(current.quantities, input.quantities),
          }
        : input,
    );
  }
  return [...byModel.values()];
}

function uniqueReferences(references: readonly UsagePricingReference[]): UsagePricingReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = usagePricingReferenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isMapLike(
  resolution: UsagePricingResolution,
): resolution is ReadonlyMap<string, UsagePricingCost | null | undefined> {
  return !Array.isArray(resolution) && typeof (resolution as {get?: unknown}).get === 'function';
}

function validUsagePricingCost(
  cost: UsagePricingCost | null | undefined,
): cost is UsagePricingCost {
  return (
    cost !== null &&
    cost !== undefined &&
    Number.isFinite(cost.amount) &&
    (cost.state === 'resolved' || cost.state === 'estimated')
  );
}
