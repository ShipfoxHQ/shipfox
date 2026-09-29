const KIB = 1024;
const MIB = 1024 * KIB;

/** Largest request body, all parts together. */
export const REQUEST_LIMIT_BYTES = 30 * MIB;
/** Largest uncompressed bundle or archive, by what the version publishes. */
export const ACTION_CONTENT_LIMIT_BYTES = 4 * MIB;
export const TEMPLATE_CONTENT_LIMIT_BYTES = 1 * MIB;
export const SOURCE_LIMIT_BYTES = 20 * MIB;
export const README_LIMIT_BYTES = 64 * KIB;
export const CHANGELOG_LIMIT_BYTES = 64 * KIB;
/** Longest `description` of an action or `summary` of a template. */
export const SUMMARY_MAX_LENGTH = 160;
