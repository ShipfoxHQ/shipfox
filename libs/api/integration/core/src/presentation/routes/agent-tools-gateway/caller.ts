import type {LeasedIntegrationToolCaller} from './dispatch.js';
import type {LeasedToolStepType} from './resolve-authorized-tools.js';

export const CALL_ID_HEADER = 'x-shipfox-call-id';
// Call ids are runner-generated identifiers; anything else stays out of the audit line.
const CALL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function leasedToolCaller(params: {
  stepType: LeasedToolStepType;
  callId: string | string[] | undefined;
}): LeasedIntegrationToolCaller {
  const callId =
    typeof params.callId === 'string' && CALL_ID_PATTERN.test(params.callId)
      ? params.callId
      : undefined;
  return {caller: params.stepType, ...(callId === undefined ? {} : {callId})};
}
