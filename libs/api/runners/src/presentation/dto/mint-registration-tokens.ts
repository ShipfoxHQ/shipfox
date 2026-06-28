import type {
  MintedRegistrationTokenDto,
  MintRegistrationTokensBatchResponseDto,
} from '@shipfox/api-runners-dto';
import type {MintEphemeralRegistrationTokensBatchResult} from '#core/ephemeral-registration-tokens.js';

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
    resource_id: result.resourceId,
    registration_token: result.rawToken,
    expires_at: result.token.expiresAt.toISOString(),
  };
}
