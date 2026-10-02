/** Calls `task` until it succeeds, giving up after `attempts` tries. */
export async function retry(task, {attempts = 3} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
