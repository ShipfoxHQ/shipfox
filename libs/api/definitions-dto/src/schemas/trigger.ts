export interface TriggerDto {
  source: string;
  event: string;
  with?: Record<string, unknown>;
  filter?: string;
}
