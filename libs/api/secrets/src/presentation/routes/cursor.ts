export function encodeManagementCursor(cursor: string): string {
  return Buffer.from(cursor, 'utf8').toString('base64url');
}

export function decodeManagementCursor(cursor: string | undefined): string | null {
  if (!cursor) return null;

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}
