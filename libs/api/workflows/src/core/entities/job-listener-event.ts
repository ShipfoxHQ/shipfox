export type JobListenerEventDisposition = 'fire' | 'resolve';

export interface JobListenerEvent {
  id: string;
  jobId: string;
  disposition: JobListenerEventDisposition;
  eventRef: string;
  deliveryId: string;
  source: string;
  event: string;
  payload: unknown;
  receivedAt: Date;
  consumedByExecutionId: string | null;
  createdAt: Date;
}
