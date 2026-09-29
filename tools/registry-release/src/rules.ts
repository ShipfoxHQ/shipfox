import type {BuiltPackage} from './build.js';

export const SUMMARY_MAX_LENGTH = 160;
export const README_MAX_BYTES = 64 * 1024;
export const SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const CONTENT_MAX_BYTES = {template: 1024 * 1024, action: 4 * 1024 * 1024};

// An SPDX license expression: identifiers joined by AND, OR, and WITH, with optional parentheses.
const SPDX_EXPRESSION = /^\(?[A-Za-z0-9.+-]+(?: (?:AND|OR|WITH) \(?[A-Za-z0-9.+-]+\)?)*\)?$/;

/**
 * The publish-time metadata rules the registry enforces, checked before
 * anything is uploaded. Composition and schema rules run in the recipe.
 */
export function publishRuleIssues(built: BuiltPackage): string[] {
  const issues: string[] = [];
  if (built.license === undefined || !SPDX_EXPRESSION.test(built.license)) {
    issues.push('package.json needs a `license` that is an SPDX identifier, such as MIT');
  }
  const summary = built.kind === 'template' ? built.manifest.summary : built.manifest.description;
  const field = built.kind === 'template' ? 'summary' : 'description';
  if (typeof summary !== 'string' || summary === '' || summary.length > SUMMARY_MAX_LENGTH) {
    issues.push(`\`${field}\` must be 1 to ${SUMMARY_MAX_LENGTH} characters`);
  }
  if (built.readme && built.readme.bytes > README_MAX_BYTES) {
    issues.push(
      `README.md is ${built.readme.bytes} bytes, above the ${README_MAX_BYTES} byte limit`,
    );
  }
  if (built.content.bytes > CONTENT_MAX_BYTES[built.kind]) {
    issues.push(
      `The ${built.kind} content is ${built.content.bytes} bytes, above the ${CONTENT_MAX_BYTES[built.kind]} byte limit`,
    );
  }
  if (built.source.bytes > SOURCE_MAX_BYTES) {
    issues.push(
      `The source archive is ${built.source.bytes} bytes, above the ${SOURCE_MAX_BYTES} byte limit`,
    );
  }
  return issues;
}
