import type {ProvisionedRunnerLaunch, ProvisionerIdentity} from '@shipfox/provisioner-core';
import {buildInstanceTags, parseInstanceIdentity, SHIPFOX_TAGS} from '#instance-identity.js';
import type {Ec2TemplateSpec} from '#templates.js';

const identity: ProvisionerIdentity = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
};

const launch: ProvisionedRunnerLaunch<Ec2TemplateSpec> = {
  provisionedRunnerId: 'runner-1',
  reservationId: '00000000-0000-4000-8000-000000000003',
  registrationToken: 'sf_ert_secret',
  registrationTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  runnerEnv: {},
  template: {
    key: 'small',
    labels: ['ubuntu22', 'ubuntu22-2vcpu'],
    maxConcurrency: 1,
    cost: 1,
    spec: {
      ami: 'ami-0123456789abcdef0',
      instanceType: 'm6i.large',
      market: 'spot',
      spotMaxPrice: null,
      subnets: ['subnet-a'],
      securityGroups: ['sg-a'],
      associatePublicIp: false,
      rootVolumeGb: 100,
      rootDeviceName: '/dev/sda1',
    },
  },
};

describe('instance identity tags', () => {
  it('builds every Shipfox tag and an instance Name', () => {
    const tags = buildInstanceTags({launch, identity});

    expect(tags).toEqual({
      [SHIPFOX_TAGS.provisionedRunnerId]: 'runner-1',
      [SHIPFOX_TAGS.provisionerId]: identity.id,
      [SHIPFOX_TAGS.reservationId]: launch.reservationId,
      [SHIPFOX_TAGS.templateKey]: 'small',
      [SHIPFOX_TAGS.workspaceId]: identity.workspaceId,
      [SHIPFOX_TAGS.labels]: 'ubuntu22,ubuntu22-2vcpu',
      Name: 'runner-1',
    });
  });

  it('round-trips identity through tags and canonicalizes labels', () => {
    const tags = buildInstanceTags({launch, identity});
    tags[SHIPFOX_TAGS.labels] = 'Ubuntu22, ubuntu22-2vcpu, ubuntu22';

    const parsed = parseInstanceIdentity({tags});

    expect(parsed).toEqual({
      provisionedRunnerId: 'runner-1',
      provisionerId: identity.id,
      reservationId: launch.reservationId,
      templateKey: 'small',
      workspaceId: identity.workspaceId,
      labels: ['ubuntu22', 'ubuntu22-2vcpu'],
    });
  });

  it('uses Name when the provisioned runner tag is absent', () => {
    const tags = buildInstanceTags({launch, identity});
    delete tags[SHIPFOX_TAGS.provisionedRunnerId];

    const parsed = parseInstanceIdentity({tags});

    expect(parsed.provisionedRunnerId).toBe('runner-1');
  });

  it('omits optional fields when their tags are absent', () => {
    const parsed = parseInstanceIdentity({tags: {Name: 'runner-1'}});

    expect(parsed).toEqual({provisionedRunnerId: 'runner-1', labels: []});
  });
});
