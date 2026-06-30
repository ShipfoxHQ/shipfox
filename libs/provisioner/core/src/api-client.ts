import {
  type MintRegistrationTokensBatchBodyDto,
  type MintRegistrationTokensBatchResponseDto,
  mintRegistrationTokensBatchResponseSchema,
  type PollDemandBodyDto,
  type PollDemandResponseDto,
  type ProvisionerIdentityResponseDto,
  pollDemandResponseSchema,
  provisionerIdentityResponseSchema,
  type ReportProvisionedRunnersBodyDto,
  type ReportProvisionedRunnersResponseDto,
  reportProvisionedRunnersResponseSchema,
} from '@shipfox/api-runners-dto';
import ky, {HTTPError, type KyInstance} from 'ky';

/** Extra wall-clock the client allows a long-poll beyond its server-side wait. */
const LONG_POLL_TIMEOUT_BUFFER_MS = 15_000;

/** Raised when the provisioner token is missing, revoked, expired, or rejected. */
export class ProvisionerAuthenticationError extends Error {
  constructor(public readonly status: number) {
    super(`Provisioner token was rejected by the API (status ${status}).`);
    this.name = 'ProvisionerAuthenticationError';
  }
}

export interface ProvisionerClient {
  getIdentity(): Promise<ProvisionerIdentityResponseDto>;
  pollDemand(
    body: PollDemandBodyDto,
    options?: {signal?: AbortSignal},
  ): Promise<PollDemandResponseDto>;
  mintRegistrationTokens(
    body: MintRegistrationTokensBatchBodyDto,
    options?: {signal?: AbortSignal},
  ): Promise<MintRegistrationTokensBatchResponseDto>;
  reportProvisionedRunners(
    body: ReportProvisionedRunnersBodyDto,
    options?: {signal?: AbortSignal},
  ): Promise<ReportProvisionedRunnersResponseDto>;
}

export function createProvisionerClient(params: {
  baseUrl: string;
  token: string;
}): ProvisionerClient {
  const baseUrl = params.baseUrl.endsWith('/') ? params.baseUrl : `${params.baseUrl}/`;
  const api: KyInstance = ky.create({
    baseUrl,
    headers: {Authorization: `Bearer ${params.token}`},
  });

  return {
    getIdentity() {
      return withAuthMapping(async () => {
        const response = await api.get('provisioners/me');
        return provisionerIdentityResponseSchema.parse(await response.json());
      });
    },

    pollDemand(body, options = {}) {
      return withAuthMapping(async () => {
        const response = await api.post('provisioners/demand/poll', {
          json: body,
          timeout: (body.wait_seconds ?? 0) * 1000 + LONG_POLL_TIMEOUT_BUFFER_MS,
          ...(options.signal ? {signal: options.signal} : {}),
        });
        return pollDemandResponseSchema.parse(await response.json());
      });
    },

    mintRegistrationTokens(body, options = {}) {
      return withAuthMapping(async () => {
        const response = await api.post('provisioners/runner-registration-tokens/batch', {
          json: body,
          ...(options.signal ? {signal: options.signal} : {}),
        });
        return mintRegistrationTokensBatchResponseSchema.parse(await response.json());
      });
    },

    reportProvisionedRunners(body, options = {}) {
      return withAuthMapping(async () => {
        const response = await api.post('provisioners/provisioned-runners/report', {
          json: body,
          ...(options.signal ? {signal: options.signal} : {}),
        });
        return reportProvisionedRunnersResponseSchema.parse(await response.json());
      });
    },
  };
}

// A rejected provisioner token surfaces the same way on every call (poll, mint, or the
// startup identity check), so the loop can recognize "token revoked" rather than treat
// it as a generic transient error.
async function withAuthMapping<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof HTTPError && isAuthStatus(error.response.status)) {
      throw new ProvisionerAuthenticationError(error.response.status);
    }
    throw error;
  }
}

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export {HTTPError};
