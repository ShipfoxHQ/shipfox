interface PostgresErrorFields {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const visited = new Set<object>();
  let current = error;

  while (typeof current === 'object' && current !== null && !visited.has(current)) {
    visited.add(current);
    const postgresError = current as PostgresErrorFields;
    if (postgresError.code === '23505' && postgresError.constraint === constraint) return true;
    current = postgresError.cause;
  }

  return false;
}
