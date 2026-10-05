import {defineClientFeature} from '@shipfox/client-shell';
import {createElement, type FunctionComponent, lazy, Suspense} from 'react';
import type {
  WorkspaceSetupChecklistProps,
  WorkspaceSetupHostProps,
} from './components/setup-checklist-types.js';

export const onboardingFeature = defineClientFeature({
  id: 'shipfox.onboarding',
});

// Each slot suspends on its own hidden boundary. Without one, the lazy load
// suspends the host route and replaces the whole page with its pending loader.
function lazySlot<Props extends object>(
  load: () => Promise<FunctionComponent<Props>>,
): FunctionComponent<Props> {
  const Slot: FunctionComponent<Props> = lazy(async () => ({default: await load()}));
  return (props) => createElement(Suspense, {fallback: null}, createElement(Slot, props));
}

export const WorkspaceSetupChecklist = lazySlot<WorkspaceSetupChecklistProps>(
  async () => (await import('./components/setup-checklist.js')).WorkspaceSetupChecklist,
);

export const WorkspaceSetupIndicator = lazySlot<WorkspaceSetupHostProps>(
  async () => (await import('./components/setup-checklist.js')).WorkspaceSetupIndicator,
);

export const ProjectFirstWorkflowPanel = lazySlot<{projectId: string}>(
  async () =>
    (await import('./components/project-first-workflow-panel.js')).ProjectFirstWorkflowPanel,
);
