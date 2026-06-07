export type RuntimeTypeReferenceField = Readonly<{
  name: string;
  type: string;
}>;

export type RuntimeTypeReference = Readonly<
  | {
      kind: 'alias';
      name: string;
      type: string;
    }
  | {
      kind: 'interface';
      name: string;
      fields: readonly RuntimeTypeReferenceField[];
    }
>;

const objectFieldPattern = /^([A-Za-z][A-Za-z0-9]*)\??: (.+);$/;

export function renderRuntimeTypeReferenceSections(
  sourceText: string,
  typeNames: readonly string[],
): readonly string[] {
  return extractRuntimeTypeReferences(sourceText, typeNames).map(renderRuntimeTypeReferenceSection);
}

export function extractRuntimeTypeReferences(
  sourceText: string,
  typeNames: readonly string[],
): readonly RuntimeTypeReference[] {
  return typeNames.map((typeName) => extractRuntimeTypeReference(sourceText, typeName));
}

function extractRuntimeTypeReference(sourceText: string, typeName: string): RuntimeTypeReference {
  const typeMarker = `export type ${typeName} =`;
  const typeMarkerIndex = sourceText.indexOf(typeMarker);

  if (typeMarkerIndex >= 0) {
    const start = typeMarkerIndex + typeMarker.length;
    const end = findTerminator(sourceText, start);
    return {
      kind: 'alias',
      name: typeName,
      type: normalizeWhitespace(sourceText.slice(start, end)),
    };
  }

  const interfaceMarker = `export interface ${typeName} `;
  const interfaceMarkerIndex = sourceText.indexOf(interfaceMarker);

  if (interfaceMarkerIndex >= 0) {
    const bodyStart = sourceText.indexOf('{', interfaceMarkerIndex);
    const bodyEnd = findMatchingBrace(sourceText, bodyStart);
    return {
      kind: 'interface',
      name: typeName,
      fields: extractObjectFields(sourceText.slice(bodyStart + 1, bodyEnd)),
    };
  }

  throw new Error(`Unable to find exported runtime type "${typeName}"`);
}

function renderRuntimeTypeReferenceSection(reference: RuntimeTypeReference): string {
  if (reference.kind === 'alias') {
    return `#### ${reference.name}\n\nAlias: \`${reference.type}\`.`;
  }

  const rows = reference.fields.map(
    (field) => `| \`${field.name}\` | \`${escapeTableCell(field.type)}\` |`,
  );

  return [`#### ${reference.name}`, '', '| Field | Type |', '| --- | --- |', ...rows].join('\n');
}

function extractObjectFields(body: string): readonly RuntimeTypeReferenceField[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = objectFieldPattern.exec(line);
      if (!match) {
        throw new Error(`Unsupported runtime object field syntax: ${line}`);
      }

      return {
        name: match[1] as string,
        type: normalizeWhitespace(match[2] as string),
      };
    });
}

function findTerminator(sourceText: string, start: number): number {
  for (let index = start; index < sourceText.length; index += 1) {
    if (sourceText[index] === ';') return index;
  }

  throw new Error('Unable to find type alias terminator');
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
