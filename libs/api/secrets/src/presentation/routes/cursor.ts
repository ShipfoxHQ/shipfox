interface ManagementCursor {
  key: string;
}

export function encodeManagementCursor(cursor: string): string {
  return Buffer.from(JSON.stringify({key: cursor} satisfies ManagementCursor), 'utf8').toString(
    'base64url',
  );
}

export function decodeManagementCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const {key} = parsed as Partial<ManagementCursor>;
    if (typeof key !== 'string' || key.length === 0) return undefined;
    return key;
  } catch {
    return undefined;
  }
}
