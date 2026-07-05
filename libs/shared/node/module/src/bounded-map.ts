export interface BoundedMapOptions {
  stopOnError?: boolean | undefined;
}

export async function boundedMap<T, U>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<U>,
  options: BoundedMapOptions = {},
): Promise<U[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }

  const results = new Array<U>(items.length);
  let next = 0;
  let aborted = false;
  const errors: unknown[] = [];

  async function worker(): Promise<void> {
    while (!aborted && next < items.length) {
      const index = next;
      next += 1;

      try {
        results[index] = await mapper(items[index] as T, index);
      } catch (error) {
        errors.push(error);
        if (options.stopOnError ?? true) {
          aborted = true;
          throw error;
        }
      }
    }
  }

  await Promise.all(Array.from({length: Math.min(limit, items.length)}, () => worker()));

  if (errors.length > 0 && !(options.stopOnError ?? true)) {
    throw new AggregateError(errors, 'One or more boundedMap tasks failed');
  }

  return results;
}
