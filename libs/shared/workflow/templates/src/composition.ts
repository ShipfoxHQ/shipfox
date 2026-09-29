/**
 * Composition formats the composer can write. A format freezes marker handling, indentation,
 * header writing, and option application, so a base composed at adoption stays reproducible after
 * the composer changes. A change to any of them is a new format with its own code path; the
 * behavior of a supported format never changes. `test/golden/` guards this byte for byte.
 */
export const SUPPORTED_COMPOSITIONS: readonly number[] = [1];

/** The format callers get when they do not pass one. */
export const CURRENT_COMPOSITION = 1;

export class UnsupportedCompositionError extends Error {
  readonly composition: number;

  constructor(composition: number) {
    super(
      `Unsupported template composition ${composition}; supported: ${SUPPORTED_COMPOSITIONS.join(', ')}`,
    );
    this.name = 'UnsupportedCompositionError';
    this.composition = composition;
  }
}

export function assertSupportedComposition(composition: number): void {
  if (!SUPPORTED_COMPOSITIONS.includes(composition)) {
    throw new UnsupportedCompositionError(composition);
  }
}
