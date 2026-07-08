export function deadlineReached(deadline: number | undefined): boolean {
  return deadline !== undefined && Date.now() >= deadline;
}

export function remainingMs(deadline: number | undefined): number | undefined {
  return deadline === undefined ? undefined : Math.max(0, deadline - Date.now());
}
