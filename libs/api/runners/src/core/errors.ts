export class RunningJobExecutionNotFoundError extends Error {
  constructor(jobExecutionId: string) {
    super(`Running job execution not found: ${jobExecutionId}`);
    this.name = 'RunningJobExecutionNotFoundError';
  }
}

export class ManualRegistrationTokenNotFoundError extends Error {
  constructor(tokenId: string) {
    super(`Manual registration token not found: ${tokenId}`);
    this.name = 'ManualRegistrationTokenNotFoundError';
  }
}

export class ProvisionerTokenNotFoundError extends Error {
  constructor(tokenId: string) {
    super(`Provisioner token not found: ${tokenId}`);
    this.name = 'ProvisionerTokenNotFoundError';
  }
}

export class EmptyRunnerLabelsError extends Error {
  constructor() {
    super('Runner labels cannot be empty');
    this.name = 'EmptyRunnerLabelsError';
  }
}

export class EmptyRequiredLabelsError extends Error {
  constructor() {
    super('Required labels cannot be empty');
    this.name = 'EmptyRequiredLabelsError';
  }
}

export class RegistrationTokenConsumedError extends Error {
  constructor(public readonly ephemeralTokenId: string) {
    super(`Ephemeral registration token has already been consumed: ${ephemeralTokenId}`);
    this.name = 'RegistrationTokenConsumedError';
  }
}

export class RegistrationTokenExpiredError extends Error {
  constructor(public readonly ephemeralTokenId: string) {
    super(`Ephemeral registration token has expired: ${ephemeralTokenId}`);
    this.name = 'RegistrationTokenExpiredError';
  }
}

export class RegistrationTokenWorkspaceMismatchError extends Error {
  constructor(
    public readonly ephemeralTokenId: string,
    public readonly workspaceId: string,
  ) {
    super(
      `Ephemeral registration token ${ephemeralTokenId} does not belong to workspace ${workspaceId}`,
    );
    this.name = 'RegistrationTokenWorkspaceMismatchError';
  }
}

export class ActiveEphemeralRegistrationTokenExistsError extends Error {
  constructor(
    public readonly workspaceId: string,
    public readonly provisionerId: string,
    public readonly providerRunnerId: string,
  ) {
    super(
      `Active ephemeral registration token already exists for provisioned runner ${providerRunnerId} in workspace ${workspaceId}`,
    );
    this.name = 'ActiveEphemeralRegistrationTokenExistsError';
  }
}

export class ReservationNotFoundError extends Error {
  constructor(public readonly reservationId: string) {
    super(`Reservation not found: ${reservationId}`);
    this.name = 'ReservationNotFoundError';
  }
}

export class ReservationExpiredError extends Error {
  constructor(public readonly reservationId: string) {
    super(`Reservation has expired: ${reservationId}`);
    this.name = 'ReservationExpiredError';
  }
}

export class CapacityNotAssignableError extends Error {
  constructor(public readonly capacityId: string) {
    super(`Capacity cannot be assigned: ${capacityId}`);
    this.name = 'CapacityNotAssignableError';
  }
}
export class CapacityAlreadyAssignedError extends Error {
  constructor(public readonly capacityId: string) {
    super(`Capacity is already assigned: ${capacityId}`);
    this.name = 'CapacityAlreadyAssignedError';
  }
}
export class ReservationAlreadyAssignedError extends Error {
  constructor(public readonly reservationId: string) {
    super(`Reservation is already assigned: ${reservationId}`);
    this.name = 'ReservationAlreadyAssignedError';
  }
}

export class RegistrationTokenBatchTooLargeError extends Error {
  constructor(
    public readonly requested: number,
    public readonly max: number,
  ) {
    super(
      `Registration token batch requested ${requested} provisioned runners, exceeding max ${max}`,
    );
    this.name = 'RegistrationTokenBatchTooLargeError';
  }
}

export class RegistrationTokenBatchExceedsReservationError extends Error {
  constructor(
    public readonly requested: number,
    public readonly reservationCount: number,
    public readonly alreadyMinted: number = 0,
  ) {
    super(
      `Registration token batch requested ${requested} provisioned runners with ${alreadyMinted} already minted, exceeding reservation count ${reservationCount}`,
    );
    this.name = 'RegistrationTokenBatchExceedsReservationError';
  }
}

export class ActiveEphemeralRegistrationTokensExistError extends Error {
  constructor(public readonly providerRunnerIds: string[]) {
    super(
      `Active ephemeral registration tokens already exist for provisioned runners: ${providerRunnerIds.join(', ')}`,
    );
    this.name = 'ActiveEphemeralRegistrationTokensExistError';
  }
}

export class RunnerSessionExhaustedError extends Error {
  constructor(public readonly runnerSessionId: string) {
    super(`Runner session claim limit exhausted: ${runnerSessionId}`);
    this.name = 'RunnerSessionExhaustedError';
  }
}
