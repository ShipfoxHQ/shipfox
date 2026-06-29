import type {
  MintedRegistrationTokenDto,
  MintRegistrationTokensBatchResponseDto,
  MintRegistrationTokensProvisionedRunnerDto,
} from '@shipfox/api-runners-dto';
import type {
  MintEphemeralRegistrationTokensBatchProvisionedRunner,
  MintEphemeralRegistrationTokensBatchResult,
} from '#core/ephemeral-registration-tokens.js';

export function toMintRegistrationTokensProvisionedRunners(
  provisionedRunners: MintRegistrationTokensProvisionedRunnerDto[],
): MintEphemeralRegistrationTokensBatchProvisionedRunner[] {
  return provisionedRunners.map((provisionedRunner) => ({
    provisionedRunnerId: provisionedRunner.provisioned_runner_id,
  }));
}

export function toMintRegistrationTokensResponseDto(
  result: MintEphemeralRegistrationTokensBatchResult[],
): MintRegistrationTokensBatchResponseDto {
  return {
    tokens: result.map(toMintedRegistrationTokenDto),
  };
}

function toMintedRegistrationTokenDto(
  result: MintEphemeralRegistrationTokensBatchResult,
): MintedRegistrationTokenDto {
  return {
    provisioned_runner_id: result.provisionedRunnerId,
    registration_token: result.rawToken,
    expires_at: result.token.expiresAt.toISOString(),
  };
}
