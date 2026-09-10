// @vitest-environment jsdom
import {act, screen} from '@testing-library/react';
import {useEffect} from 'react';
import {defineClientFeature} from '#contract.js';
import {
  type ClientUsagePricing,
  type UsagePricingReference,
  usagePricingReferenceKey,
  useUsagePricing,
} from '#runtime/client-usage-pricing.js';
import {renderComposedShell} from '#test/render.js';
import {defineRoute} from './define-route.js';

const WORKSPACE_ID = 'workspace-a';
const OTHER_WORKSPACE_ID = 'workspace-b';
const reference: UsagePricingReference = {
  workspaceId: WORKSPACE_ID,
  kind: 'run',
  id: 'run-1',
};

function PricingProbe() {
  const pricing = useUsagePricing();
  useEffect(() => {
    if (!pricing) return;
    void pricing.resolveCosts([reference]);
    void pricing.estimate({
      reference,
      quantities: {
        computeSeconds: 1,
        requestCount: 1,
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        webSearchRequests: 0,
      },
    });
    pricing.formatMoney(1);
  }, [pricing]);
  return <h1>{pricing ? 'Pricing configured' : 'Pricing absent'}</h1>;
}

function pricingFeature() {
  return defineClientFeature({
    id: 'acme.pricing',
    routes: [{path: '/w/$workspaceSlug/pricing', parent: 'workspaceLayout', impl: 'pricing'}],
  });
}

async function renderPricingProbe(usagePricing?: ClientUsagePricing) {
  await renderComposedShell({
    features: [pricingFeature()],
    initialPath: '/w/workspace/pricing',
    resolveImpl: () => defineRoute({staticData: {frame: 'content'}, component: PricingProbe}),
    ...(usagePricing ? {usagePricing} : {}),
  });
}

describe('ClientUsagePricing', () => {
  test('is absent when no application pricing is composed', async () => {
    await renderPricingProbe();

    expect(await screen.findByRole('heading', {name: 'Pricing absent'})).toBeVisible();
  });

  test('wires all pricing operations through the composed provider', async () => {
    const resolveCosts = vi.fn(() => new Map());
    const estimate = vi.fn(() => ({amount: 1, state: 'estimated' as const}));
    const formatMoney = vi.fn(() => '$1.00');

    await renderPricingProbe({
      resolveCosts,
      estimate,
      formatMoney,
      disclosure: 'Estimated from list prices. Nothing is billed.',
    });

    expect(await screen.findByRole('heading', {name: 'Pricing configured'})).toBeVisible();
    expect(resolveCosts).toHaveBeenCalledWith([reference]);
    expect(estimate).toHaveBeenCalled();
    expect(formatMoney).toHaveBeenCalledWith(1);
  });

  test('keeps model and upstream references distinct', () => {
    const first = usagePricingReferenceKey({
      workspaceId: WORKSPACE_ID,
      kind: 'step-attempt',
      id: 'attempt-1',
      model: 'model-a',
      upstream: 'upstream-a',
    });
    const second = usagePricingReferenceKey({
      workspaceId: WORKSPACE_ID,
      kind: 'step-attempt',
      id: 'attempt-1',
      model: 'model-b',
      upstream: 'upstream-a',
    });

    expect(first).toBe('workspace-a:step-attempt:attempt-1:["model-a","upstream-a"]');
    expect(second).not.toBe(first);
  });

  test('encodes partial and colon-containing model identity without collisions', () => {
    const aggregate = usagePricingReferenceKey({
      workspaceId: WORKSPACE_ID,
      kind: 'step-attempt',
      id: 'attempt-1',
    });
    const modelOnly = usagePricingReferenceKey({
      workspaceId: WORKSPACE_ID,
      kind: 'step-attempt',
      id: 'attempt-1',
      model: 'model-a',
    });
    const upstreamOnly = usagePricingReferenceKey({
      workspaceId: WORKSPACE_ID,
      kind: 'step-attempt',
      id: 'attempt-1',
      upstream: 'model-a',
    });
    const firstColonValue = usagePricingReferenceKey({
      workspaceId: WORKSPACE_ID,
      kind: 'step-attempt',
      id: 'attempt-1',
      model: 'model:a',
      upstream: 'upstream',
    });
    const secondColonValue = usagePricingReferenceKey({
      workspaceId: WORKSPACE_ID,
      kind: 'step-attempt',
      id: 'attempt-1',
      model: 'model',
      upstream: 'a:upstream',
    });

    expect(aggregate).toBe('workspace-a:step-attempt:attempt-1');
    expect(modelOnly).not.toBe(upstreamOnly);
    expect(firstColonValue).not.toBe(secondColonValue);
  });

  test('fences every reference kind by workspace identity', () => {
    const references: UsagePricingReference[] = [
      {workspaceId: WORKSPACE_ID, kind: 'run', id: 'same-id'},
      {workspaceId: WORKSPACE_ID, kind: 'job-execution', id: 'same-id'},
      {workspaceId: WORKSPACE_ID, kind: 'step-attempt', id: 'same-id'},
    ];

    expect(new Set(references.map(usagePricingReferenceKey)).size).toBe(3);
    const firstReference = references[0];
    if (!firstReference) throw new Error('Expected a pricing reference');
    expect(usagePricingReferenceKey({...firstReference, workspaceId: OTHER_WORKSPACE_ID})).not.toBe(
      usagePricingReferenceKey(firstReference),
    );
  });

  test('preserves a pricing disclosure through the safe provider', async () => {
    function DisclosureProbe() {
      return <p>{useUsagePricing()?.disclosure}</p>;
    }

    await renderComposedShell({
      features: [pricingFeature()],
      initialPath: '/w/workspace/pricing',
      resolveImpl: () => defineRoute({staticData: {frame: 'content'}, component: DisclosureProbe}),
      usagePricing: {
        resolveCosts: () => new Map(),
        estimate: () => null,
        formatMoney: () => '$0.00',
        disclosure: 'Estimated from list prices. Nothing is billed.',
      },
    });

    expect(await screen.findByText('Estimated from list prices. Nothing is billed.')).toBeVisible();
  });

  test('contains synchronous implementation failures', async () => {
    const usagePricing: ClientUsagePricing = {
      resolveCosts: () => {
        throw new Error('pricing unavailable');
      },
      estimate: () => {
        throw new Error('pricing unavailable');
      },
      formatMoney: () => {
        throw new Error('pricing unavailable');
      },
    };

    await renderPricingProbe(usagePricing);

    expect(await screen.findByRole('heading', {name: 'Pricing configured'})).toBeVisible();
  });

  test('contains asynchronously rejected implementation failures', async () => {
    const usagePricing: ClientUsagePricing = {
      resolveCosts: () => Promise.reject(new Error('pricing unavailable')),
      estimate: () => Promise.reject(new Error('pricing unavailable')),
      formatMoney: () => '$1.00',
    };

    await renderPricingProbe(usagePricing);

    expect(await screen.findByRole('heading', {name: 'Pricing configured'})).toBeVisible();
    await act(async () => {
      await Promise.resolve();
    });
  });
});
