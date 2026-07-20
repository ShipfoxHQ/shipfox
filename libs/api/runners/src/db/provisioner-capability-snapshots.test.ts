import {and, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  hasActiveWorkspaceProvisionerCapability,
  listActiveWorkspaceProvisionerCapabilitySnapshots,
  listStaleWorkspaceProvisionerCapabilitySnapshots,
  publishWorkspaceProvisionerCapabilitySnapshot,
} from '#db/provisioner-capability-snapshots.js';
import {provisionerCapabilitySnapshots} from '#db/schema/provisioner-capability-snapshots.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {provisionerTokenFactory} from '#test/index.js';

describe('workspace provisioner capability snapshots', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('atomically replaces one provisioner complete template snapshot', async () => {
    const provisioner = await provisionerTokenFactory.create({workspaceId});

    await publishWorkspaceProvisionerCapabilitySnapshot({
      workspaceId,
      provisionerId: provisioner.id,
      templates: [template('linux', ['linux'], 4, 1, 3), template('macos', ['macos'], 2, 0, 2)],
    });
    await publishWorkspaceProvisionerCapabilitySnapshot({
      workspaceId,
      provisionerId: provisioner.id,
      templates: [template('linux-arm64', ['linux', 'arm64'], 0, 1, 0)],
    });

    const rows = await snapshotsFor(provisioner.id);
    expect(rows).toEqual([
      expect.objectContaining({
        templateKey: 'linux-arm64',
        labels: ['arm64', 'linux'],
        availableSlots: 0,
        starting: 1,
        running: 0,
      }),
    ]);
  });

  it('keeps zero-slot overlapping capability active for every workspace provisioner', async () => {
    const first = await provisionerTokenFactory.create({workspaceId});
    const second = await provisionerTokenFactory.create({workspaceId});

    await publishWorkspaceProvisionerCapabilitySnapshot({
      workspaceId,
      provisionerId: first.id,
      templates: [template('linux', ['linux', 'x64'], 0, 0, 1)],
    });
    await publishWorkspaceProvisionerCapabilitySnapshot({
      workspaceId,
      provisionerId: second.id,
      templates: [template('linux-gpu', ['linux', 'gpu'], 2, 1, 1)],
    });

    const active = await listActiveWorkspaceProvisionerCapabilitySnapshots({
      workspaceId,
      windowSeconds: 60,
    });
    const hasLinux = await hasActiveWorkspaceProvisionerCapability({
      workspaceId,
      requiredLabels: ['linux'],
      windowSeconds: 60,
    });
    const hasLinuxX64 = await hasActiveWorkspaceProvisionerCapability({
      workspaceId,
      requiredLabels: ['linux', 'x64'],
      windowSeconds: 60,
    });

    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({provisionerId: first.id, availableSlots: 0}),
        expect.objectContaining({provisionerId: second.id, labels: ['gpu', 'linux']}),
      ]),
    );
    expect(hasLinux).toBe(true);
    expect(hasLinuxX64).toBe(true);
  });

  it('requires every advertised label to be present, not just an overlap', async () => {
    const provisioner = await provisionerTokenFactory.create({workspaceId});

    await publishWorkspaceProvisionerCapabilitySnapshot({
      workspaceId,
      provisionerId: provisioner.id,
      templates: [template('linux', ['linux'], 1, 0, 0)],
    });

    const hasLinuxArm64 = await hasActiveWorkspaceProvisionerCapability({
      workspaceId,
      requiredLabels: ['linux', 'arm64'],
      windowSeconds: 60,
    });

    expect(hasLinuxArm64).toBe(false);
  });

  it('excludes stale and revoked provisioner capability from active matching', async () => {
    const staleProvisioner = await provisionerTokenFactory.create({workspaceId});
    const revokedProvisioner = await provisionerTokenFactory.create({workspaceId});

    await publishWorkspaceProvisionerCapabilitySnapshot({
      workspaceId,
      provisionerId: staleProvisioner.id,
      templates: [template('stale-linux', ['linux'], 1, 0, 1)],
    });
    await publishWorkspaceProvisionerCapabilitySnapshot({
      workspaceId,
      provisionerId: revokedProvisioner.id,
      templates: [template('revoked-macos', ['macos'], 1, 0, 1)],
    });
    await db()
      .update(provisionerCapabilitySnapshots)
      .set({advertisedAt: new Date(Date.now() - 61_000)})
      .where(eq(provisionerCapabilitySnapshots.provisionerId, staleProvisioner.id));
    await db()
      .update(provisionerTokens)
      .set({revokedAt: new Date()})
      .where(eq(provisionerTokens.id, revokedProvisioner.id));

    const active = await listActiveWorkspaceProvisionerCapabilitySnapshots({
      workspaceId,
      windowSeconds: 60,
    });
    const stale = await listStaleWorkspaceProvisionerCapabilitySnapshots({
      workspaceId,
      windowSeconds: 60,
    });
    const hasLinux = await hasActiveWorkspaceProvisionerCapability({
      workspaceId,
      requiredLabels: ['linux'],
      windowSeconds: 60,
    });
    const hasMacos = await hasActiveWorkspaceProvisionerCapability({
      workspaceId,
      requiredLabels: ['macos'],
      windowSeconds: 60,
    });

    expect(active).toEqual([]);
    expect(stale.map((snapshot) => snapshot.provisionerId).sort()).toEqual(
      [staleProvisioner.id, revokedProvisioner.id].sort(),
    );
    expect(hasLinux).toBe(false);
    expect(hasMacos).toBe(false);
  });

  function snapshotsFor(provisionerId: string) {
    return db()
      .select()
      .from(provisionerCapabilitySnapshots)
      .where(
        and(
          eq(provisionerCapabilitySnapshots.workspaceId, workspaceId),
          eq(provisionerCapabilitySnapshots.provisionerId, provisionerId),
        ),
      );
  }

  function template(
    templateKey: string,
    labels: string[],
    availableSlots: number,
    starting: number,
    running: number,
  ) {
    return {templateKey, labels, availableSlots, starting, running};
  }
});
