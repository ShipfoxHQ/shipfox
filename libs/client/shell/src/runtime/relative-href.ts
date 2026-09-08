const RELATIVE_HREF_ORIGIN = 'https://shipfox-relative.invalid';

/**
 * Returns a root-relative href unchanged when it cannot resolve to another origin.
 * Absolute, protocol-relative, and malformed values return undefined.
 */
export function toSameOriginRelativeHref(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  ) {
    return undefined;
  }

  try {
    const target = new URL(value, RELATIVE_HREF_ORIGIN);
    return target.origin === RELATIVE_HREF_ORIGIN ? value : undefined;
  } catch {
    return undefined;
  }
}
