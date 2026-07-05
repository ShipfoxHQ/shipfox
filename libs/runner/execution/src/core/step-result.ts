import type {StepErrorDto} from '@shipfox/api-workflows-dto';

export interface StepResult {
  success: boolean;
  // Legacy agent summary string produced in memory; never sent to the API.
  output?: string;
  // Run-step key/value outputs reported in the API report `output` field.
  outputs?: Record<string, string>;
  // Populated when success is false. Null on success.
  error: StepErrorDto;
  // 0 on success, the exit code on failure, null when signal-killed or never spawned.
  exit_code: number | null;
}
