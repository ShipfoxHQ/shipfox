import {useClientAnalytics} from '@shipfox/client-shell/runtime';
import {useEffect, useRef, useState} from 'react';
import type {ChecklistQueryState} from '#hooks/api/setup-checklist.js';

type ChecklistHost = 'panel' | 'popover';

export function useCompletionTransition(
  queryState: ChecklistQueryState,
  host: ChecklistHost,
  onCompleted?: (completed: boolean) => void,
) {
  const analytics = useClientAnalytics();
  const observedIncomplete = useRef(false);
  const completionHandled = useRef(false);
  const [showCompletion, setShowCompletion] = useState(false);

  useEffect(() => {
    if (
      queryState.baseSettled &&
      !queryState.checklist.complete &&
      queryState.checklist.openCount > 0
    ) {
      observedIncomplete.current = true;
    }

    if (!queryState.completionReady) return;

    if (!queryState.checklist.complete) {
      setShowCompletion(false);
      return;
    }

    if (!observedIncomplete.current || completionHandled.current) return;
    completionHandled.current = true;
    setShowCompletion(true);
    onCompleted?.(true);
    analytics.capture('onboarding_checklist_completed', {host});
  }, [
    analytics,
    host,
    onCompleted,
    queryState.baseSettled,
    queryState.checklist.complete,
    queryState.checklist.openCount,
    queryState.completionReady,
  ]);

  return showCompletion;
}

export function useShownAnalytics(host: ChecklistHost, visible: boolean) {
  const analytics = useClientAnalytics();
  const shown = useRef(false);

  useEffect(() => {
    if (!visible || shown.current) return;
    shown.current = true;
    analytics.capture('onboarding_checklist_shown', {host});
  }, [analytics, host, visible]);
}

/**
 * Observes the first-workflow row going from not done to done. A workspace
 * that already had a definition on load never celebrates. Activation is always
 * captured; the burst plays only when the checklist stays open, because a
 * transition that also completes the checklist gets the checklist's burst.
 */
export function useFirstWorkflowActivation(queryState: ChecklistQueryState) {
  const analytics = useClientAnalytics();
  const observedNotDone = useRef(false);
  const activationHandled = useRef(false);
  const [celebrating, setCelebrating] = useState(false);
  const state = queryState.firstWorkflow?.state;
  const completionReady = queryState.completionReady;
  const completesChecklist = queryState.checklist.complete;

  useEffect(() => {
    if (state === undefined) return;
    if (state !== 'done') {
      observedNotDone.current = true;
      return;
    }
    // Until every family reports, the checklist cannot say whether this
    // transition completes it, and the burst would then play twice.
    if (!completionReady) return;
    if (!observedNotDone.current || activationHandled.current) return;
    activationHandled.current = true;
    analytics.capture('first_workflow_activated');
    if (!completesChecklist) setCelebrating(true);
  }, [analytics, completesChecklist, completionReady, state]);

  return celebrating;
}

export function useFirstWorkflowTestRunShown(host: ChecklistHost, shown: boolean) {
  const analytics = useClientAnalytics();
  const captured = useRef(false);

  useEffect(() => {
    if (!shown || captured.current) return;
    captured.current = true;
    analytics.capture('first_workflow_test_run_shown', {host});
  }, [analytics, host, shown]);
}
