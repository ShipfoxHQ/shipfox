import type {
  MintedRegistrationTokenDto,
  MintRegistrationTokensBatchResponseDto,
  MintRegistrationTokensResourceDto,
} from '@shipfox/api-runners-dto';
import type {
  MintEphemeralRegistrationTokensBatchResource,
  MintEphemeralRegistrationTokensBatchResult,
} from '#core/ephemeral-registration-tokens.js';

export function toMintRegistrationTokensResources(
  resources: MintRegistrationTokensResourceDto[],
): MintEphemeralRegistrationTokensBatchResource[] {
  // Batch token minting binds resources to a reservation; template attribution is outside the token model.
  return resources.map((resource) => ({
    resourceId: resource.resource_id,
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
    resource_id: result.resourceId,
    registration_token: result.rawToken,
    expires_at: result.token.expiresAt.toISOString(),
  };
}
