import type {StepErrorDto} from '@shipfox/api-workflows-dto';

export interface StepResult {
  success: boolean;
  // Buffered output a step produces in memory (e.g. an agent step's summary). Run
  // steps leave it unset: their stdout/stderr streams through the log pipeline
  // (onOutput sink) rather than being buffered here. Never sent to the API.
  output?: string;
  // Populated when success is false. Null on success.
  error: StepErrorDto;
  // 0 on success, the exit code on failure, null when signal-killed or never spawned.
  exit_code: number | null;
}
