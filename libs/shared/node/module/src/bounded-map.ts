export interface BoundedMapOptions {
  stopOnError?: boolean | undefined;
  signal?: AbortSignal | undefined;
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
  const stopOnError = options.stopOnError ?? true;
  const {signal} = options;

  async function worker(): Promise<void> {
    while (!aborted && !signal?.aborted && next < items.length) {
      const index = next;
      next += 1;

      try {
        results[index] = await mapper(items[index] as T, index);
      } catch (error) {
        errors.push(error);
        if (stopOnError) {
          aborted = true;
        }
      }
    }
  }

  await Promise.all(Array.from({length: Math.min(limit, items.length)}, () => worker()));

  if (errors.length > 0 && stopOnError) {
    throw errors[0];
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'One or more boundedMap tasks failed');
  }

  return results;
}
