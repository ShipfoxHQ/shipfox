import {
  formatRegistryReference,
  parseRegistryReference,
  type RegistryReference,
} from '@shipfox/registry-format';

export interface RegistryTemplateHeader {
  ref: RegistryReference;
  bindings: Readonly<Record<string, string>>;
  options: Readonly<Record<string, string>>;
}

export interface LegacyTemplateHeader {
  legacy: {id: string; revision: number; bindings: Readonly<Record<string, string>>};
}

export type TemplateHeader = RegistryTemplateHeader | LegacyTemplateHeader;

const whitespacePattern = /\s+/;
const newlinePattern = /\r?\n/;
const headerLinePattern = /^#\s*shipfox-template:\s*(.*?)\s*$/;
const identifierPattern = /^[a-z0-9][a-z0-9_-]*$/;
const pairPattern = /^([a-z0-9][a-z0-9_-]*)=([a-z0-9][a-z0-9_-]*)$/;
const legacyIdentityPattern = /^([a-z0-9][a-z0-9_-]*)@(\d+)$/;
const groupPattern = /^(roles|options):(.*)$/;

/**
 * Reads the `# shipfox-template:` header from workflow YAML, or from the header line alone. Only
 * the leading comment lines are searched, so a later mention inside a prompt is not a header.
 *
 * Both grammars parse without the manifest. The manifest validates the pairs afterwards. Returns
 * `undefined` when there is no header or it matches neither grammar.
 */
export function parseTemplateHeader(text: string): TemplateHeader | undefined {
  const body = headerBody(text);
  if (body === undefined) return undefined;

  const [head = '', ...groups] = body.split(';');
  if (head.includes('/')) return parseRegistryHeader(head, groups);
  if (groups.length > 0) return undefined;
  return parseLegacyHeader(head);
}

/** Writes the header line for either grammar. Pairs are written in the order they are given. */
export function formatTemplateHeader(header: TemplateHeader): string {
  if ('legacy' in header) {
    const {id, revision, bindings} = header.legacy;
    return `# shipfox-template: ${[`${id}@${revision}`, ...formatPairs(bindings)].join(' ')}`;
  }

  const {ref, bindings, options} = header;
  const reference = formatRegistryReference(ref);
  if (parseRegistryReference(reference) === undefined) {
    throw new Error(`Invalid registry reference for the template header: ${reference}`);
  }
  const groups = [
    ...(Object.keys(bindings).length > 0 ? [`roles: ${formatPairs(bindings).join(' ')}`] : []),
    ...(Object.keys(options).length > 0 ? [`options: ${formatPairs(options).join(' ')}`] : []),
  ];
  return `# shipfox-template: ${[reference, ...groups].join('; ')}`;
}

function headerBody(text: string): string | undefined {
  for (const line of text.split(newlinePattern)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('#')) return undefined;
    const match = headerLinePattern.exec(trimmed);
    if (match !== null) return match[1];
  }
  return undefined;
}

function parseRegistryHeader(
  head: string,
  groups: readonly string[],
): RegistryTemplateHeader | undefined {
  const ref = parseRegistryReference(head.trim());
  if (ref === undefined) return undefined;

  let bindings: Record<string, string> | undefined;
  let options: Record<string, string> | undefined;
  for (const group of groups) {
    const match = groupPattern.exec(group.trim());
    const pairs = parsePairs((match?.[2] ?? '').trim().split(whitespacePattern));
    if (pairs === undefined) return undefined;

    // The grammar fixes the order, and each group appears once.
    if (match?.[1] === 'roles' && bindings === undefined && options === undefined) {
      bindings = pairs;
    } else if (match?.[1] === 'options' && options === undefined) {
      options = pairs;
    } else {
      return undefined;
    }
  }
  return {ref, bindings: bindings ?? {}, options: options ?? {}};
}

function parseLegacyHeader(head: string): LegacyTemplateHeader | undefined {
  const [identity = '', ...pairs] = head.trim().split(whitespacePattern);
  const match = legacyIdentityPattern.exec(identity);
  const bindings = parsePairs(pairs);
  if (match?.[1] === undefined || bindings === undefined) return undefined;

  const revision = Number(match[2]);
  if (!Number.isSafeInteger(revision)) return undefined;
  return {legacy: {id: match[1], revision, bindings}};
}

function parsePairs(tokens: readonly string[]): Record<string, string> | undefined {
  const pairs: Record<string, string> = {};
  for (const token of tokens) {
    const match = pairPattern.exec(token);
    const [key, value] = [match?.[1], match?.[2]];
    if (key === undefined || value === undefined || Object.hasOwn(pairs, key)) return undefined;
    pairs[key] = value;
  }
  return pairs;
}

function formatPairs(pairs: Readonly<Record<string, string>>): string[] {
  return Object.entries(pairs).map(([key, value]) => {
    if (!(identifierPattern.test(key) && identifierPattern.test(value))) {
      throw new Error(`Invalid template header pair: ${key}=${value}`);
    }
    return `${key}=${value}`;
  });
}
