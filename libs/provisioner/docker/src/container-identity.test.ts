import type {ProviderRunnerLaunch, ProvisionerIdentity} from '@shipfox/provisioner-core';
import {buildContainerLabels, parseContainerIdentity, SHIPFOX_LABELS} from '#container-identity.js';
import type {DockerContainerView} from '#docker-engine.js';
import type {DockerTemplateSpec} from '#templates.js';

const identity: ProvisionerIdentity = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
};

const launch: ProviderRunnerLaunch<DockerTemplateSpec> = {
  providerRunnerId: 'runner-1',
  reservationId: '00000000-0000-4000-8000-000000000003',
  registrationToken: 'sf_ert_secret',
  registrationTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  runnerEnv: {},
  template: {
    key: 'small',
    labels: ['ubuntu22', 'ubuntu22-2vcpu'],
    maxConcurrency: 1,
    cost: 1,
    spec: {image: 'runner:latest', cpu: 1, memory: '1g'},
  },
};

describe('container identity labels', () => {
  it('round-trips launch identity through Docker labels', () => {
    const labels = buildContainerLabels({launch, identity});

    const parsed = parseContainerIdentity(view({name: 'runner-1', labels}));

    expect(parsed).toEqual({
      providerRunnerId: 'runner-1',
      provisionerId: identity.id,
      reservationId: launch.reservationId,
      templateKey: 'small',
      workspaceId: identity.workspaceId,
      labels: ['ubuntu22', 'ubuntu22-2vcpu'],
    });
  });

  it('falls back to the container name when the provisioned runner label is missing', () => {
    const labels = buildContainerLabels({launch, identity});
    delete labels[SHIPFOX_LABELS.providerRunnerId];

    const parsed = parseContainerIdentity(view({name: '/runner-1', labels}));

    expect(parsed.providerRunnerId).toBe('runner-1');
  });

  it('allows reservation_id to be absent', () => {
    const labels = buildContainerLabels({launch, identity});
    delete labels[SHIPFOX_LABELS.reservationId];

    const parsed = parseContainerIdentity(view({name: 'runner-1', labels}));

    expect(parsed.reservationId).toBeUndefined();
    expect(parsed.labels).toEqual(['ubuntu22', 'ubuntu22-2vcpu']);
  });
});

function view(args: {name: string; labels: Record<string, string>}): DockerContainerView {
  return {
    id: 'container-id',
    name: args.name,
    labels: args.labels,
    state: 'running',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
