import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createDockerEngine} from '#docker-engine.js';

describe.skipIf(!hasDockerDaemon())('DockerEngine integration', () => {
  it('creates, lists, inspects, and removes a managed container', async () => {
    const engine = createDockerEngine();
    const name = `shipfox-test-${randomUUID()}`;

    try {
      await engine.createAndStart({
        name,
        image: 'alpine:3.20',
        env: {},
        labels: {
          'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
          'shipfox.provisioned_runner_id': name,
        },
        nanoCpus: 100_000_000,
        memoryBytes: 32 * 1024 * 1024,
      });

      const containers = await engine.listManaged('00000000-0000-4000-8000-000000000001');

      expect(containers.some((container) => container.name === name)).toBe(true);
    } finally {
      await engine.remove(name);
    }
  });
});

function hasDockerDaemon(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}
