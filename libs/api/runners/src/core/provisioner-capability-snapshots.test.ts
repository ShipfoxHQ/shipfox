import {eq} from 'drizzle-orm';
import {config} from '#config.js';
import {db} from '#db/db.js';
import {publishWorkspaceProvisionerCapabilitySnapshot} from '#db/provisioner-capability-snapshots.js';
import {provisionerCapabilitySnapshots} from '#db/schema/provisioner-capability-snapshots.js';
import {provisionerTokenFactory} from '#test/index.js';
import {hasActiveWorkspaceProvisionerCapability} from './provisioner-capability-snapshots.js';

describe('workspace provisioner capability core', () => {
  it('applies the configured active window to capability matching', async () => {
    const workspaceId = crypto.randomUUID();
    const provisioner = await provisionerTokenFactory.create({workspaceId});

    await publishWorkspaceProvisionerCapabilitySnapshot({
      workspaceId,
      provisionerId: provisioner.id,
      templates: [
        {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 0},
      ],
    });
    await db()
      .update(provisionerCapabilitySnapshots)
      .set({
        advertisedAt: new Date(Date.now() - (config.PROVISIONER_ACTIVE_WINDOW_SECONDS + 1) * 1000),
      })
      .where(eq(provisionerCapabilitySnapshots.provisionerId, provisioner.id));

    const hasLinux = await hasActiveWorkspaceProvisionerCapability({
      workspaceId,
      requiredLabels: ['linux'],
    });

    expect(hasLinux).toBe(false);
  });
});
