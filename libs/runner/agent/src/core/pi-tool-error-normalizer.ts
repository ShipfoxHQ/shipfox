import type {InlineExtension} from '@earendil-works/pi-coding-agent';

export const PI_TOOL_ERROR_NORMALIZER_EXTENSION_NAME = 'shipfox-pi-tool-error-normalizer';

/**
 * Pi's tool result event carries the error bit separately from a tool's returned details. Direct
 * integration tools return the gateway's `CallToolResult` as details, so keep its `isError` visible
 * to the agent core.
 */
export function createPiToolErrorNormalizerExtension(): InlineExtension {
  return {
    name: PI_TOOL_ERROR_NORMALIZER_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.on('tool_result', (event) => {
        if (event.isError || !isErrorResult(event.details)) return undefined;
        return {isError: true};
      });
    },
  };
}

function isErrorResult(details: unknown): boolean {
  return (
    details !== null &&
    typeof details === 'object' &&
    (details as Record<string, unknown>).isError === true
  );
}
