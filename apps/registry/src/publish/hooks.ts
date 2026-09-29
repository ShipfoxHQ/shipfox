import {logger} from '@shipfox/node-opentelemetry';

const HOOK_TIMEOUT_MS = 5_000;

/** Tells each hook that a version is published, such as the docs rebuild. Failures are logged. */
export async function callPublishHooks({
  hooks,
  event,
}: {
  hooks: readonly string[];
  event: {package: string; kind: string; version: string; published_at: string};
}): Promise<void> {
  await Promise.all(
    hooks.map(async (hook) => {
      try {
        const response = await fetch(hook, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
        });
        if (!response.ok) {
          logger().warn(
            {hook: new URL(hook).origin, status: response.status},
            'A publish hook answered with an error',
          );
        }
      } catch (error) {
        logger().warn({err: error, hook: new URL(hook).origin}, 'A publish hook failed');
      }
    }),
  );
}
