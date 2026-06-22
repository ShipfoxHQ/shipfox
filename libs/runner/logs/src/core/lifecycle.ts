/**
 * The close/drain/dispose lifecycle shared by every per-attempt log stream (process output
 * and agent-session forwarding). The orchestration settles a stream through this contract
 * without knowing which producer it carries.
 */
export interface LogStreamLifecycle {
  /**
   * Records the trailing end marker and resolves with the final raw stream length. Does NOT
   * wait for upload — the report is never blocked on log drain.
   */
  close(): Promise<{streamLength: number}>;
  /**
   * Waits (bounded) for the uploader to ship everything spooled so far.
   * `timeoutMs` defaults to `SHIPFOX_LOG_DRAIN_TIMEOUT_MS`.
   */
  drain(opts?: {signal?: AbortSignal; timeoutMs?: number}): Promise<void>;
  dispose(): void;
}
