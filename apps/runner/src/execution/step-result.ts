import type {StepErrorDtoShape} from '@shipfox/api-workflows-dto';

export interface StepResult {
  success: boolean;
  // Captured stdout/stderr for runner-side observability and tests (the
  // grandchild-PID extraction in run-step.test.ts depends on this). Never sent
  // to the API: per-step logs are a separate concern (future S3-backed logs).
  output: string;
  // Populated when success is false. Null on success.
  error: StepErrorDtoShape;
  // 0 on success, the exit code on failure, null when signal-killed or never spawned.
  exit_code: number | null;
}
