import {logger} from '@shipfox/node-opentelemetry';
import {startRunner} from '@shipfox/runner-orchestration';
import {defaultProtocolClient} from '@shipfox/runner-protocol';

try {
  await startRunner({protocol: defaultProtocolClient});
} catch (error) {
  logger().error({error}, 'Fatal runner error');
  process.exit(1);
}
