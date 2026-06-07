export type TypeReferenceField = Readonly<{
  name: string;
  type: string;
}>;

export type TypeReference = Readonly<
  | {
      kind: 'alias';
      name: string;
      type: string;
    }
  | {
      kind: 'object';
      name: string;
      fields: readonly TypeReferenceField[];
    }
>;

const objectFieldPattern = /^([A-Za-z][A-Za-z0-9]*)\??: (.+);$/;

export function renderTypeReferenceSections(
  sourceText: string,
  typeNames: readonly string[],
): readonly string[] {
  return extractTypeReferences(sourceText, typeNames).map(renderTypeReferenceSection);
}

export function extractTypeReferences(
  sourceText: string,
  typeNames: readonly string[],
): readonly TypeReference[] {
  return typeNames.map((typeName) => {
    const typeExpression = extractTypeExpression(sourceText, typeName);
    const fields = extractReadonlyObjectFields(typeExpression);

    if (fields) {
      return {kind: 'object', name: typeName, fields};
    }

    return {kind: 'alias', name: typeName, type: normalizeWhitespace(typeExpression)};
  });
}

function renderTypeReferenceSection(reference: TypeReference): string {
  if (reference.kind === 'alias') {
    return `#### ${reference.name}\n\nAlias: \`${reference.type}\`.`;
  }

  const rows = reference.fields.map(
    (field) => `| \`${field.name}\` | \`${escapeTableCell(field.type)}\` |`,
  );

  return [`#### ${reference.name}`, '', '| Field | Type |', '| --- | --- |', ...rows].join('\n');
}

function extractTypeExpression(sourceText: string, typeName: string): string {
  const marker = `export type ${typeName} =`;
  const markerIndex = sourceText.indexOf(marker);

  if (markerIndex < 0) {
    throw new Error(`Unable to find exported type alias "${typeName}"`);
  }

  const start = markerIndex + marker.length;
  const end = findTypeAliasEnd(sourceText, start);
  return sourceText.slice(start, end).trim();
}

function findTypeAliasEnd(sourceText: string, start: number): number {
  let braceDepth = 0;

  for (let index = start; index < sourceText.length; index += 1) {
    const char = sourceText[index];

    if (char === '{') {
      braceDepth += 1;
      continue;
    }

    if (char === '}') {
      braceDepth -= 1;
      continue;
    }

    if (char === ';' && braceDepth === 0) {
      return index;
    }
  }

  throw new Error('Unable to find type alias terminator');
}

function extractReadonlyObjectFields(
  typeExpression: string,
): readonly TypeReferenceField[] | undefined {
  const objectStart = typeExpression.indexOf('Readonly<{');
  if (objectStart < 0) return undefined;

  const bodyStart = typeExpression.indexOf('{', objectStart);
  const bodyEnd = findMatchingBrace(typeExpression, bodyStart);
  const body = typeExpression.slice(bodyStart + 1, bodyEnd);

  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = objectFieldPattern.exec(line);
      if (!match) {
        throw new Error(`Unsupported object type field syntax: ${line}`);
      }

      return {
        name: match[1] as string,
        type: normalizeWhitespace(match[2] as string),
      };
    });
}

function findMatchingBrace(sourceText: string, start: number): number {
  let depth = 0;

  for (let index = start; index < sourceText.length; index += 1) {
    const char = sourceText[index];

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error('Unable to find matching object type brace');
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|');
}
