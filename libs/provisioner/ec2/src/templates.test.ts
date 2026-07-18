import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import {Ec2TemplateConfigError, loadEc2Templates} from '#templates.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'provisioner-ec2-'));
});

afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function writeTemplates(contents: string): string {
  const path = join(dir, `${randomUUID()}.yaml`);
  writeFileSync(path, contents);
  return path;
}

function template(overrides: Record<string, string> = {}, extra = ''): string {
  const defaults = `
templates:
  t:
    labels: [ubuntu22]
    ami: ami-0123456789abcdef0
    instance_type: m6i.large
    market: spot
    spot_max_price: 0.05
    subnets: [subnet-aaa]
    security_groups: [sg-runner]
    associate_public_ip: false
    root_volume_gb: 100
    max_concurrency: 100
    cost: 5
`;

  return (
    Object.entries(overrides).reduce(
      (contents, [field, value]) =>
        contents.replace(new RegExp(`^(\\s*${field}: ).*$`, 'm'), `$1${value}`),
      defaults,
    ) + extra
  );
}

const VALID = `
templates:
  ec2-ubuntu22-2vcpu-spot:
    labels: [ubuntu22, ubuntu22-2vcpu]
    ami: ami-0123456789abcdef0
    instance_type: m6i.large
    market: spot
    spot_max_price: 0.05
    subnets: [subnet-aaa, subnet-bbb]
    security_groups: [sg-runner]
    iam_instance_profile: shipfox-runner
    associate_public_ip: false
    root_volume_gb: 100
    max_concurrency: 200
    cost: 5
  ec2-ubuntu22-2vcpu-on-demand:
    labels: [ubuntu22, ubuntu22-2vcpu-on-demand]
    ami: ami-0123456789abcdef1
    instance_type: m6i.large
    market: on-demand
    subnets: [subnet-ccc]
    security_groups: [sg-runner]
    associate_public_ip: true
    root_volume_gb: 120
    max_concurrency: 50
    cost: 10
`;

describe('loadEc2Templates', () => {
  it('maps each config entry to a provider-agnostic template', () => {
    const path = writeTemplates(VALID);

    const templates = loadEc2Templates(path);

    expect(templates).toEqual([
      {
        key: 'ec2-ubuntu22-2vcpu-spot',
        labels: ['ubuntu22', 'ubuntu22-2vcpu'],
        maxConcurrency: 200,
        cost: 5,
        spec: {
          ami: 'ami-0123456789abcdef0',
          instanceType: 'm6i.large',
          market: 'spot',
          spotMaxPrice: 0.05,
          subnets: ['subnet-aaa', 'subnet-bbb'],
          securityGroups: ['sg-runner'],
          iamInstanceProfile: 'shipfox-runner',
          associatePublicIp: false,
          rootVolumeGb: 100,
          rootDeviceName: '/dev/sda1',
        },
      },
      {
        key: 'ec2-ubuntu22-2vcpu-on-demand',
        labels: ['ubuntu22', 'ubuntu22-2vcpu-on-demand'],
        maxConcurrency: 50,
        cost: 10,
        spec: {
          ami: 'ami-0123456789abcdef1',
          instanceType: 'm6i.large',
          market: 'on-demand',
          spotMaxPrice: null,
          subnets: ['subnet-ccc'],
          securityGroups: ['sg-runner'],
          associatePublicIp: true,
          rootVolumeGb: 120,
          rootDeviceName: '/dev/sda1',
        },
      },
    ]);
  });

  it('accepts a null spot price', () => {
    const path = writeTemplates(template({spot_max_price: 'null'}));

    const [loaded] = loadEc2Templates(path);

    expect(loaded?.spec.spotMaxPrice).toBeNull();
  });

  it('uses the default root device name and preserves an explicit value', () => {
    const path = writeTemplates(template({}, '    root_device_name: /dev/xvda\n'));

    const templates = loadEc2Templates(path);

    expect(templates[0]?.spec.rootDeviceName).toBe('/dev/xvda');
    expect(loadEc2Templates(writeTemplates(template()))[0]?.spec.rootDeviceName).toBe('/dev/sda1');
  });

  it('canonicalizes labels (lowercase, dedupe, sort)', () => {
    const path = writeTemplates(template({labels: '[Ubuntu22, ubuntu22, ubuntu22-4cpu]'}));

    const [loaded] = loadEc2Templates(path);

    expect(loaded?.labels).toEqual(['ubuntu22', 'ubuntu22-4cpu']);
  });

  it('throws when the file is missing', () => {
    expect(() => loadEc2Templates(join(dir, 'missing.yaml'))).toThrow(Ec2TemplateConfigError);
  });

  it('throws on malformed YAML', () => {
    const path = writeTemplates('templates: [unclosed');

    expect(() => loadEc2Templates(path)).toThrow(Ec2TemplateConfigError);
  });

  it('throws when no templates are declared', () => {
    const path = writeTemplates('templates: {}');

    expect(() => loadEc2Templates(path)).toThrow('declares no templates');
  });

  it.each([
    ['ami', {ami: 'ami-invalid'}],
    ['instance_type', {instance_type: '"   "'}],
    ['market', {market: 'reserved'}],
    ['spot_max_price', {spot_max_price: '0'}],
    ['subnets', {subnets: '[]'}],
    ['security_groups', {security_groups: '[]'}],
    ['associate_public_ip', {associate_public_ip: '"false"'}],
    ['root_volume_gb', {root_volume_gb: '-1'}],
    ['max_concurrency', {max_concurrency: '0'}],
    ['cost', {cost: '0'}],
  ])('throws when %s is invalid', (field, override) => {
    const path = writeTemplates(template(override));

    expect(() => loadEc2Templates(path)).toThrow(field);
  });

  it('throws when iam_instance_profile is blank', () => {
    const path = writeTemplates(template({}, '    iam_instance_profile: "   "\n'));

    expect(() => loadEc2Templates(path)).toThrow('iam_instance_profile');
  });

  it('throws when root_device_name is blank', () => {
    const path = writeTemplates(template({}, '    root_device_name: "   "\n'));

    expect(() => loadEc2Templates(path)).toThrow('root_device_name');
  });

  it('throws when max_concurrency exceeds the limit', () => {
    const path = writeTemplates(template({max_concurrency: '100001'}));

    expect(() => loadEc2Templates(path)).toThrow('max_concurrency');
  });

  it('throws on a label that cannot be a runner label', () => {
    const path = writeTemplates(template({labels: '["not a valid label"]'}));

    expect(() => loadEc2Templates(path)).toThrow('invalid labels');
  });

  it('throws when labels are empty after normalization', () => {
    const path = writeTemplates(template({labels: '["  "]'}));

    expect(() => loadEc2Templates(path)).toThrow('no usable labels');
  });

  it('throws when there are more labels than allowed', () => {
    const labels = Array.from({length: MAX_RUNNER_LABELS + 1}, (_, index) => `label-${index}`);
    const path = writeTemplates(template({labels: `[${labels.join(', ')}]`}));

    expect(() => loadEc2Templates(path)).toThrow(`the maximum is ${MAX_RUNNER_LABELS}`);
  });

  it('throws when on-demand includes a spot price', () => {
    const path = writeTemplates(template({market: 'on-demand'}));

    expect(() => loadEc2Templates(path)).toThrow('spot_max_price');
  });

  it('throws on an unknown template key', () => {
    const path = writeTemplates(template({}, '    spot_maxprice: 0.05\n'));

    expect(() => loadEc2Templates(path)).toThrow('spot_maxprice');
  });

  it('throws on an unknown file key', () => {
    const path = writeTemplates(`${VALID}\nunknown: true`);

    expect(() => loadEc2Templates(path)).toThrow('unknown');
  });
});
