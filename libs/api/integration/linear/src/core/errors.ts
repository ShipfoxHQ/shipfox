export class LinearInstallationAlreadyLinkedError extends Error {
  constructor(organizationId: string) {
    super(`Linear organization is already linked to another Shipfox workspace: ${organizationId}`);
    this.name = 'LinearInstallationAlreadyLinkedError';
  }
}

export class LinearConnectionAlreadyLinkedError extends Error {
  constructor(connectionId: string) {
    super(
      `Integration connection is already linked to another Linear organization: ${connectionId}`,
    );
    this.name = 'LinearConnectionAlreadyLinkedError';
  }
}
