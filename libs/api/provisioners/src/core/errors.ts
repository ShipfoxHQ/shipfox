export class ProvisionerTokenNotFoundError extends Error {
  constructor(tokenId: string) {
    super(`Provisioner token not found: ${tokenId}`);
    this.name = 'ProvisionerTokenNotFoundError';
  }
}
