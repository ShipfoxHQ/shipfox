import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {
  checkRunnersRateLimit,
  RunnersRateLimitExceededError,
  RunnersRateLimitUnavailableError,
} from '#core/rate-limit.js';
import {getRunnerContext} from '#presentation/auth/index.js';

function routeName(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown';
}

async function enforceRateLimit(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  action: 'provisioner-mint' | 'ephemeral-register';
  scope: 'provisioner' | 'ephemeral-token';
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  try {
    await checkRunnersRateLimit({
      action: params.action,
      scope: params.scope,
      identifier: params.identifier,
      limit: params.limit,
      windowSeconds: params.windowSeconds,
    });
  } catch (error) {
    if (error instanceof RunnersRateLimitExceededError) {
      params.request.log.warn(
        {
          action: error.action,
          scope: error.scope,
          route: routeName(params.request),
          retryAfterSeconds: error.retryAfterSeconds,
          identifierHmacPrefix: error.identifierHmacPrefix,
        },
        'Runners rate limit blocked request',
      );
      params.reply.header('Retry-After', String(error.retryAfterSeconds));
      throw new ClientError('Rate limit exceeded', 'rate-limited', {
        status: 429,
        details: {retry_after_seconds: error.retryAfterSeconds},
        data: {
          action: error.action,
          scope: error.scope,
          route: routeName(params.request),
          identifierHmacPrefix: error.identifierHmacPrefix,
        },
        cause: error,
      });
    }

    if (error instanceof RunnersRateLimitUnavailableError) {
      params.request.log.error(
        {
          action: error.action,
          scope: error.scope,
          route: routeName(params.request),
          identifierHmacPrefix: error.identifierHmacPrefix,
          err: error,
        },
        'Runners rate limiter unavailable',
      );
      throw new ClientError('Runners rate limiter unavailable', 'runners-rate-limit-unavailable', {
        status: 503,
        data: {
          action: error.action,
          scope: error.scope,
          route: routeName(params.request),
          identifierHmacPrefix: error.identifierHmacPrefix,
        },
        cause: error,
      });
    }

    throw error;
  }
}

export function createProvisionerMintRateLimitPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    await enforceRateLimit({
      request,
      reply,
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier: provisionerTokenId,
      limit: config.PROVISIONER_MINT_RATE_LIMIT_MAX_REQUESTS,
      windowSeconds: config.PROVISIONER_MINT_RATE_LIMIT_WINDOW_SECONDS,
    });
  };
}

export function createEphemeralRegisterRateLimitPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const runner = getRunnerContext(request);
    if (runner.kind !== 'ephemeral') return;

    await enforceRateLimit({
      request,
      reply,
      action: 'ephemeral-register',
      scope: 'ephemeral-token',
      identifier: runner.ephemeralTokenId,
      limit: config.EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS,
      windowSeconds: config.EPHEMERAL_REGISTER_RATE_LIMIT_WINDOW_SECONDS,
    });
  };
}
