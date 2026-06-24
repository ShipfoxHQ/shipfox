import {isMissingStepLogStreamError, LogView, useStepAttemptLogsQuery} from '@shipfox/client-logs';
import {Alert, Button, Icon, Text} from '@shipfox/react-ui';
import {type UIEvent, useEffect, useRef} from 'react';

const TAIL_FOLLOW_THRESHOLD_PX = 24;

export interface StepAttemptLogPanelProps {
  stepId: string;
  attempt: number;
  attemptStatus: string;
}

export function StepAttemptLogPanel({stepId, attempt, attemptStatus}: StepAttemptLogPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const shouldFollowTailRef = useRef(true);
  const retryMissingStream = attemptStatus === 'running';
  const query = useStepAttemptLogsQuery(stepId, attempt, {retryMissingStream});
  const records = query.data?.records ?? [];
  const recordCount = records.length;
  const missingActiveStream =
    retryMissingStream && query.data === undefined && isMissingStepLogStreamError(query.error);
  const initialError = query.isError && query.data === undefined && !missingActiveStream;
  const staleError = query.isError && query.data !== undefined;

  useEffect(() => {
    if (recordCount === 0) return undefined;
    if (!shouldFollowTailRef.current) return undefined;

    const frame = scheduleAnimationFrame(() => {
      const scrollElement = panelRef.current?.querySelector<HTMLElement>('[data-slot="log-rows"]');
      if (!scrollElement) return;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    });

    return () => {
      cancelScheduledFrame(frame);
    };
  }, [recordCount]);

  function handleLogScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldFollowTailRef.current = distanceFromBottom <= TAIL_FOLLOW_THRESHOLD_PX;
  }

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading step logs" className="flex items-center gap-6 py-8">
        <Icon name="loader4Line" className="size-14 motion-safe:animate-spin" aria-hidden="true" />
        <Text size="xs" className="text-foreground-neutral-subtle">
          Loading logs
        </Text>
      </div>
    );
  }

  if (missingActiveStream) {
    return (
      <div role="status" aria-label="Waiting for logs" className="flex items-center gap-6 py-8">
        <Icon name="loader4Line" className="size-14 motion-safe:animate-spin" aria-hidden="true" />
        <Text size="xs" className="text-foreground-neutral-subtle">
          Waiting for logs
        </Text>
      </div>
    );
  }

  if (initialError) {
    return <StepLogsError retrying={query.isFetching} onRetry={() => void query.refetch()} />;
  }

  return (
    <div ref={panelRef} className="flex min-w-0 flex-col gap-8">
      {staleError ? (
        <Alert variant="warning" animated={false} className="px-10 py-8">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-8">
            <Text size="xs">Could not refresh logs.</Text>
            <Button
              type="button"
              size="2xs"
              variant="secondary"
              isLoading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </div>
        </Alert>
      ) : null}
      <LogView
        records={records}
        className="max-h-[40vh] rounded-8 md:max-h-[280px]"
        onScroll={handleLogScroll}
      />
    </div>
  );
}

function scheduleAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(Date.now()), 0);
}

function cancelScheduledFrame(frame: number) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

function StepLogsError({retrying, onRetry}: {retrying: boolean; onRetry: () => void}) {
  return (
    <Alert variant="error" animated={false} className="px-10 py-8">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-8">
        <Text size="xs">Could not load logs.</Text>
        <Button type="button" size="2xs" variant="secondary" isLoading={retrying} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Alert>
  );
}
