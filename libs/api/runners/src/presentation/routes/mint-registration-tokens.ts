import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  mintRegistrationTokensBatchBodySchema,
  mintRegistrationTokensBatchResponseSchema,
} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {mintEphemeralRegistrationTokensBatch} from '#core/ephemeral-registration-tokens.js';
import {
  ActiveEphemeralRegistrationTokensExistError,
  RegistrationTokenBatchExceedsReservationError,
  RegistrationTokenBatchTooLargeError,
  ReservationExpiredError,
  ReservationNotFoundError,
} from '#core/errors.js';
import {
  toMintRegistrationTokensProvisionedRunners,
  toMintRegistrationTokensResponseDto,
} from '#presentation/dto/index.js';

export const mintRegistrationTokensRoute = defineRoute({
  method: 'POST',
  path: '/runner-registration-tokens/batch',
  description: 'Mint ephemeral runner registration tokens for reserved provisioned runners',
  schema: {
    body: mintRegistrationTokensBatchBodySchema,
    response: {
      200: mintRegistrationTokensBatchResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ReservationNotFoundError) {
      throw new ClientError('Reservation not found', 'reservation-not-found', {status: 404});
    }
    if (error instanceof ReservationExpiredError) {
      throw new ClientError('Reservation has expired', 'reservation-expired', {status: 409});
    }
    if (error instanceof RegistrationTokenBatchExceedsReservationError) {
      throw new ClientError('Batch exceeds reservation count', 'batch-exceeds-reservation', {
        status: 409,
        details: {
          requested: error.requested,
          reservation_count: error.reservationCount,
        },
      });
    }
    if (error instanceof ActiveEphemeralRegistrationTokensExistError) {
      throw new ClientError('Registration token already active', 'registration-token-active', {
        status: 409,
        details: {provisioned_runner_ids: error.provisionedRunnerIds},
      });
    }
    if (error instanceof RegistrationTokenBatchTooLargeError) {
      throw new ClientError('Registration token batch is too large', 'batch-too-large', {
        status: 400,
        details: {
          requested: error.requested,
          max: error.max,
        },
      });
    }
    throw error;
  },
  handler: async (request) => {
    const {provisionerTokenId, workspaceId} = requireProvisionerContext(request);
    const result = await mintEphemeralRegistrationTokensBatch({
      workspaceId,
      provisionerId: provisionerTokenId,
      reservationId: request.body.reservation_id,
      provisionedRunners: toMintRegistrationTokensProvisionedRunners(
        request.body.provisioned_runners,
      ),
      ttlSeconds: config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS,
      maxBatchSize: config.REGISTRATION_TOKEN_BATCH_MAX,
    });

    return toMintRegistrationTokensResponseDto(result);
  },
});
