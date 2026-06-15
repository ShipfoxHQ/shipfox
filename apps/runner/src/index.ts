import {logger} from '@shipfox/node-opentelemetry';
import {startRunner} from '@shipfox/runner-orchestration';

try {
  await startRunner();
} catch (error) {
  logger().error({error}, 'Fatal runner error');
  process.exit(1);
}
