export class TriggerSubscriptionNotFoundError extends Error {
  readonly subscriptionId: string;

  constructor(subscriptionId: string) {
    super(`Trigger subscription not found: ${subscriptionId}`);
    this.name = 'TriggerSubscriptionNotFoundError';
    this.subscriptionId = subscriptionId;
  }
}

export class TriggerSubscriptionNotManualError extends Error {
  readonly subscriptionId: string;
  readonly source: string;

  constructor(subscriptionId: string, source: string) {
    super(
      `Trigger subscription ${subscriptionId} has source '${source}', expected 'manual' for manual fire`,
    );
    this.name = 'TriggerSubscriptionNotManualError';
    this.subscriptionId = subscriptionId;
    this.source = source;
  }
}

export class TriggerWorkspaceMismatchError extends Error {
  readonly subscriptionId: string;
  readonly subscriptionWorkspaceId: string;
  readonly callerWorkspaceId: string;

  constructor(subscriptionId: string, subscriptionWorkspaceId: string, callerWorkspaceId: string) {
    super(
      `Trigger subscription ${subscriptionId} belongs to workspace ${subscriptionWorkspaceId}, not ${callerWorkspaceId}`,
    );
    this.name = 'TriggerWorkspaceMismatchError';
    this.subscriptionId = subscriptionId;
    this.subscriptionWorkspaceId = subscriptionWorkspaceId;
    this.callerWorkspaceId = callerWorkspaceId;
  }
}
