import {getServiceMetricsProvider, logger} from '@shipfox/node-opentelemetry';
import {auditStoredDefinitions} from '#db/definitions.js';

const AUDIT_CACHE_TTL_MS = 60_000;

type AuditClassification = 'safe' | 'payload' | 'unknown';

interface DefinitionPayloadAuditMetrics {
  readonly safe: number;
  readonly payload: number;
  readonly unknown: number;
}

function createAuditCache(): () => Promise<DefinitionPayloadAuditMetrics> {
  let cached: {value: DefinitionPayloadAuditMetrics; expiresAt: number} | undefined;
  let refresh: Promise<DefinitionPayloadAuditMetrics> | undefined;

  return async () => {
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;

    refresh ??= auditStoredDefinitions()
      .then((audit) => {
        const value = {
          safe: audit.safeDefinitions,
          payload: audit.payloadDefinitions,
          unknown: audit.unknownDefinitions,
        } satisfies DefinitionPayloadAuditMetrics;
        cached = {value, expiresAt: Date.now() + AUDIT_CACHE_TTL_MS};
        return value;
      })
      .finally(() => {
        refresh = undefined;
      });

    return await refresh;
  };
}

/** Publishes the stored-definition audit without making it an enforcement gate. */
export function registerDefinitionsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('definitions');
  const auditCount = meter.createObservableGauge<{
    classification: AuditClassification;
  }>('definitions_historical_event_payload_audit', {
    description: 'Stored workflow definitions by historical event-payload audit class',
  });
  const getCachedAudit = createAuditCache();

  meter.addBatchObservableCallback(
    async (observer) => {
      try {
        const audit = await getCachedAudit();
        for (const classification of ['safe', 'payload', 'unknown'] as const) {
          observer.observe(auditCount, audit[classification], {classification});
        }
      } catch (error) {
        logger().warn({err: error}, 'Failed to collect stored definition payload audit metrics');
      }
    },
    [auditCount],
  );
}
