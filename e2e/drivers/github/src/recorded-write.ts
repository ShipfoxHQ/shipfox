/** A state-changing request the fake accepted, in the order it arrived. */
export interface RecordedWrite {
  kind: string;
  /** What the write acted on, such as `owner/repo#12` or `owner/repo:branch`. */
  target: string;
  payload: Record<string, unknown>;
}
