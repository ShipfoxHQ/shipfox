import {logger} from '@shipfox/node-opentelemetry';
import {startEc2Provisioner} from '@shipfox/provisioner-ec2-provider';

try {
  await startEc2Provisioner();
} catch (error) {
  logger().error({error}, 'Fatal provisioner error');
  process.exit(1);
}
