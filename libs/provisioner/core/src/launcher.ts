import {logger} from '@shipfox/node-opentelemetry';
import type {LaunchRunner} from '#types.js';

/**
 * The default launcher: it records the intent to start a runner but performs no
 * provider action. The control loop through minting ships here (ENG-617); the Docker
 * launcher that actually runs the container lands in ENG-618. The registration token
 * and the injected env it carries are secrets, so only non-sensitive identity is
 * logged.
 */
export const loggingLaunch: LaunchRunner = (launch) => {
  logger().info(
    {
      provisionedRunnerId: launch.provisionedRunnerId,
      reservationId: launch.reservationId,
      templateKey: launch.template.key,
      labels: launch.template.labels,
    },
    'Planned provisioned runner (launch not yet implemented)',
  );
  return Promise.resolve();
};
