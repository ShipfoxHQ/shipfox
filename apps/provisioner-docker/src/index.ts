import {logger} from '@shipfox/node-opentelemetry';
import {startDockerProvisioner} from '@shipfox/provisioner-docker-provider';

try {
  await startDockerProvisioner();
} catch (error) {
  logger().error({error}, 'Fatal provisioner error');
  process.exit(1);
}
