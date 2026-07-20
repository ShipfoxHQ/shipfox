import type {
  MintedRegistrationTokenDto,
  MintRegistrationTokensBatchResponseDto,
  MintRegistrationTokensRunnerInstanceDto,
} from '@shipfox/api-runners-dto';
import type {MintEphemeralRegistrationTokensBatchResult} from '#core/ephemeral-registration-tokens.js';

export function toMintRegistrationTokensRunnerInstances(
  providerRunners: MintRegistrationTokensRunnerInstanceDto[],
) {
  return providerRunners.map((runner) => ({providerRunnerId: runner.provider_runner_id}));
}

export function toMintRegistrationTokensResponseDto(
  result: MintEphemeralRegistrationTokensBatchResult[],
): MintRegistrationTokensBatchResponseDto {
  return {tokens: result.map(toMintedRegistrationTokenDto)};
}

function toMintedRegistrationTokenDto(
  result: MintEphemeralRegistrationTokensBatchResult,
): MintedRegistrationTokenDto {
  return {
    provider_runner_id: result.providerRunnerId,
    registration_token: result.rawToken,
    expires_at: result.token.expiresAt.toISOString(),
  };
}
