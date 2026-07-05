export interface CronSchedule {
  subscriptionId: string;
  workspaceId: string;
  cronExpression: string;
  timezone: string;
  nextFireAt: Date;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
