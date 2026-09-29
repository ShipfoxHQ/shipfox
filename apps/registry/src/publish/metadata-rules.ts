import parseSpdxExpression from 'spdx-expression-parse';
import {VersionRefusedError} from '#publish/errors.js';
import {README_LIMIT_BYTES, SUMMARY_MAX_LENGTH} from '#publish/limits.js';

/** The publish-time metadata rules. `related` is presentation only and is not checked. */
export function checkMetadata({
  license,
  summary,
  readme,
}: {
  license: string;
  /** The `description` of an action or the `summary` of a template. */
  summary: string | undefined;
  readme: Buffer | undefined;
}): void {
  if (summary === undefined || summary.trim() === '' || summary.length > SUMMARY_MAX_LENGTH) {
    throw new VersionRefusedError(
      'invalid-metadata',
      `The description or summary must be 1 to ${SUMMARY_MAX_LENGTH} characters`,
    );
  }
  if (!isSpdxExpression(license)) {
    throw new VersionRefusedError(
      'invalid-metadata',
      `The license ${JSON.stringify(license)} is not an SPDX license expression`,
    );
  }
  if (readme !== undefined) readmeText(readme);
}

/** The README as text. It is stored in the database, so it must be UTF-8 and small. */
export function readmeText(readme: Buffer): string {
  if (readme.length > README_LIMIT_BYTES) {
    throw new VersionRefusedError(
      'invalid-metadata',
      `The README is larger than ${README_LIMIT_BYTES} bytes`,
    );
  }
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(readme);
  } catch (error) {
    throw new VersionRefusedError('invalid-metadata', 'The README is not UTF-8 text', {
      cause: error,
    });
  }
}

function isSpdxExpression(license: string): boolean {
  try {
    parseSpdxExpression(license);
    return true;
  } catch {
    return false;
  }
}
