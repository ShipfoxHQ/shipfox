import {canonicalizeLabels} from '@shipfox/runner-labels';
import {and, arrayContains, eq, gt, isNotNull, isNull, lte, or, sql} from 'drizzle-orm';
import type {ProvisionerCapabilitySnapshot} from '#core/entities/provisioner-capability-snapshot.js';
import {db} from './db.js';
import type {ReservationTemplate} from './reservations.js';
import {
  provisionerCapabilitySnapshots,
  toProvisionerCapabilitySnapshot,
} from './schema/provisioner-capability-snapshots.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';

export async function publishWorkspaceProvisionerCapabilitySnapshot(params: {
  workspaceId: string;
  provisionerId: string;
  templates: ReservationTemplate[];
}): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .delete(provisionerCapabilitySnapshots)
      .where(eq(provisionerCapabilitySnapshots.provisionerId, params.provisionerId));

    if (params.templates.length === 0) return;

    await tx.insert(provisionerCapabilitySnapshots).values(
      params.templates.map((template) => ({
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        templateKey: template.templateKey,
        labels: [...canonicalizeLabels(template.labels)],
        availableSlots: template.availableSlots,
        starting: template.starting,
        running: template.running,
      })),
    );
  });
}

export async function listActiveWorkspaceProvisionerCapabilitySnapshots(params: {
  workspaceId: string;
  windowSeconds: number;
}): Promise<ProvisionerCapabilitySnapshot[]> {
  const rows = await db()
    .select({snapshot: provisionerCapabilitySnapshots})
    .from(provisionerCapabilitySnapshots)
    .innerJoin(
      provisionerTokens,
      eq(provisionerTokens.id, provisionerCapabilitySnapshots.provisionerId),
    )
    .where(and(...activeWorkspaceProvisionerCapabilityConditions(params)));

  return rows.map(({snapshot}) => toProvisionerCapabilitySnapshot(snapshot));
}

export async function listStaleWorkspaceProvisionerCapabilitySnapshots(params: {
  workspaceId: string;
  windowSeconds: number;
}): Promise<ProvisionerCapabilitySnapshot[]> {
  const rows = await db()
    .select({snapshot: provisionerCapabilitySnapshots})
    .from(provisionerCapabilitySnapshots)
    .innerJoin(
      provisionerTokens,
      eq(provisionerTokens.id, provisionerCapabilitySnapshots.provisionerId),
    )
    .where(
      and(
        eq(provisionerCapabilitySnapshots.workspaceId, params.workspaceId),
        or(
          lte(
            provisionerCapabilitySnapshots.advertisedAt,
            sql`now() - (${params.windowSeconds} || ' seconds')::interval`,
          ),
          eq(provisionerTokens.scope, 'installation'),
          isNull(provisionerTokens.workspaceId),
          provisionerTokenIsUnavailable(),
        ),
      ),
    );

  return rows.map(({snapshot}) => toProvisionerCapabilitySnapshot(snapshot));
}

export async function hasActiveWorkspaceProvisionerCapability(params: {
  workspaceId: string;
  requiredLabels: string[];
  windowSeconds: number;
}): Promise<boolean> {
  const [row] = await db()
    .select({id: provisionerCapabilitySnapshots.id})
    .from(provisionerCapabilitySnapshots)
    .innerJoin(
      provisionerTokens,
      eq(provisionerTokens.id, provisionerCapabilitySnapshots.provisionerId),
    )
    .where(
      and(
        ...activeWorkspaceProvisionerCapabilityConditions(params),
        arrayContains(provisionerCapabilitySnapshots.labels, [
          ...canonicalizeLabels(params.requiredLabels),
        ]),
      ),
    )
    .limit(1);

  return row !== undefined;
}

function activeWorkspaceProvisionerCapabilityConditions(params: {
  workspaceId: string;
  windowSeconds: number;
}) {
  return [
    eq(provisionerCapabilitySnapshots.workspaceId, params.workspaceId),
    eq(provisionerTokens.workspaceId, params.workspaceId),
    eq(provisionerTokens.scope, 'workspace' as const),
    isNull(provisionerTokens.revokedAt),
    or(isNull(provisionerTokens.expiresAt), gt(provisionerTokens.expiresAt, sql`now()`)),
    gt(
      provisionerCapabilitySnapshots.advertisedAt,
      sql`now() - (${params.windowSeconds} || ' seconds')::interval`,
    ),
  ];
}

function provisionerTokenIsUnavailable() {
  return or(
    isNotNull(provisionerTokens.revokedAt),
    and(isNotNull(provisionerTokens.expiresAt), lte(provisionerTokens.expiresAt, sql`now()`)),
  );
}
