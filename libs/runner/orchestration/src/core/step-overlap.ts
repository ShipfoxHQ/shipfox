/** One step's span in a {@link StepOverlap}. */
export interface StepOverlapSpan {
  /** How many steps ran during this span, itself included. Readable after the span ended. */
  count(): number;
  end(): void;
}

/**
 * Counts the steps that overlapped each other. The runner's out-of-memory counter belongs to the
 * whole runner, so a kill seen during one step may belong to any step that ran alongside it.
 */
export class StepOverlap {
  private readonly active = new Set<{overlapped: Set<object>}>();

  begin(): StepOverlapSpan {
    const span = {overlapped: new Set<object>(this.active)};
    for (const other of this.active) other.overlapped.add(span);
    this.active.add(span);
    return {
      count: () => span.overlapped.size + 1,
      end: () => {
        this.active.delete(span);
      },
    };
  }
}
