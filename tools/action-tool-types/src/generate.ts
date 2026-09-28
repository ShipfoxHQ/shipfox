import {spawnSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {agentToolResultKind} from '@shipfox/api-integration-spi';
import {compile, type JSONSchema} from 'json-schema-to-typescript';
import type {ProviderToolCatalog} from '#catalogs.js';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const generatedFilePath = fileURLToPath(
  new URL('../../../libs/shared/workflow/actions/src/generated/tool-catalog.ts', import.meta.url),
);
export const generatedGrantsFilePath = fileURLToPath(
  new URL('../../../libs/shared/workflow/actions/src/generated/tool-grants.ts', import.meta.url),
);

const HEADER = `// Generated from the provider tool catalogs by @shipfox/action-tool-types. Do not edit.
// Regenerate with \`pnpm --filter @shipfox/action-tool-types generate\`.`;

interface CallableTool {
  name: string;
  description: string;
  typeName: string;
  schema: JSONSchema;
  result: 'json' | 'file';
}

/** Renders the generated module, formatted as committed. */
export async function renderToolCatalogSource(
  catalogs: readonly ProviderToolCatalog[],
): Promise<string> {
  const providers = [...catalogs].sort((a, b) => a.provider.localeCompare(b.provider));
  const mapLines: string[] = [];
  const declarations: string[] = [];
  const typeNames = new Set<string>();

  mapLines.push('/** Tool arguments and result kinds, by provider slug and tool name. */');
  mapLines.push('export interface ProviderToolCatalog {');
  for (const {provider, tools} of providers) {
    mapLines.push(`${JSON.stringify(provider)}: {`);
    for (const tool of callableTools(provider, tools)) {
      if (typeNames.has(tool.typeName)) {
        throw new Error(`Two tools generate the type name ${tool.typeName}.`);
      }
      typeNames.add(tool.typeName);
      mapLines.push(jsDoc(tool.description));
      mapLines.push(
        `${JSON.stringify(tool.name)}: {arguments: ${tool.typeName}; result: ${JSON.stringify(tool.result)}};`,
      );
      declarations.push(await compileArguments(tool));
    }
    mapLines.push('};');
  }
  mapLines.push('}');

  const source = [HEADER, mapLines.join('\n'), ...declarations].join('\n\n');
  return formatWithBiome(source, generatedFilePath);
}

/**
 * Renders the runtime grant data the testing helper checks calls against: each tool's
 * sensitivity and result kind, and each family method's sensitivity.
 */
export function renderToolGrantsSource(catalogs: readonly ProviderToolCatalog[]): string {
  const providers = [...catalogs].sort((a, b) => a.provider.localeCompare(b.provider));
  const grants = Object.fromEntries(
    providers.map(({provider, tools}) => [
      provider,
      Object.fromEntries(
        [...tools]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((entry) => [
            entry.id,
            {
              sensitivity: entry.sensitivity,
              result: agentToolResultKind(entry),
              ...(entry.methods === undefined
                ? {}
                : {
                    methods: Object.fromEntries(
                      [...entry.methods]
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .map((method) => [method.id, method.sensitivity]),
                    ),
                  }),
            },
          ]),
      ),
    ]),
  );
  const source = [
    HEADER,
    `export interface ToolGrant {
  readonly sensitivity: 'read' | 'write';
  readonly result: 'json' | 'file';
  /** Method sensitivities of a family tool, by method id. */
  readonly methods?: Readonly<Record<string, 'read' | 'write'>>;
}`,
    `/** Grant data by provider slug and tool id. */
export const toolGrants: Readonly<Record<string, Readonly<Record<string, ToolGrant>>>> = ${JSON.stringify(grants)};`,
  ].join('\n\n');
  return formatWithBiome(source, generatedGrantsFilePath);
}

/** Tool ids, plus one `family.method` name per method with `method` filled by the runner. */
function callableTools(
  provider: string,
  tools: ProviderToolCatalog['tools'],
): readonly CallableTool[] {
  const callable: CallableTool[] = [];
  for (const entry of [...tools].sort((a, b) => a.id.localeCompare(b.id))) {
    const result = agentToolResultKind(entry);
    callable.push({
      name: entry.id,
      description: entry.description,
      typeName: typeName(provider, entry.id),
      schema: entry.inputSchema as JSONSchema,
      result,
    });
    for (const method of [...(entry.methods ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      callable.push({
        name: `${entry.id}.${method.id}`,
        description: method.description,
        typeName: typeName(provider, `${entry.id}_${method.id}`),
        schema: methodSchema(entry.inputSchema as JSONSchema, method.id),
        result,
      });
    }
  }
  return callable;
}

/**
 * The family schema narrowed to one method. A family may list per-method required fields in
 * `oneOf` branches keyed by a `method` const. That branch's fields become required, and the
 * other branches and `method` itself are dropped.
 */
function methodSchema(family: JSONSchema, method: string): JSONSchema {
  const {oneOf, ...schema} = family;
  const branch = oneOf?.find((candidate) => candidate.properties?.method?.const === method);
  const {method: _method, ...properties} = schema.properties ?? {};
  const required = [...requiredNames(schema), ...requiredNames(branch)].filter(
    (name) => name !== 'method',
  );
  return {...schema, properties, required: [...new Set(required)]};
}

function requiredNames(schema: JSONSchema | undefined): string[] {
  return Array.isArray(schema?.required) ? schema.required : [];
}

function compileArguments(tool: CallableTool): Promise<string> {
  // Titles would name nested types, which can collide across tools. Inline them instead.
  const {description: _description, ...schema} = withoutTitles(tool.schema) as JSONSchema;
  return compile(schema, tool.typeName, {
    bannerComment: '',
    format: false,
    ignoreMinAndMaxItems: true,
    strictIndexSignatures: false,
    unknownAny: true,
  });
}

const SUBSCHEMA_KEYS = ['items', 'additionalProperties', 'not'] as const;
const SUBSCHEMA_LIST_KEYS = ['anyOf', 'oneOf', 'allOf'] as const;

function withoutTitles(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutTitles);
  if (typeof schema !== 'object' || schema === null) return schema;
  const {title: _title, ...rest} = schema as Record<string, unknown>;
  if (isRecord(rest.properties)) {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties).map(([name, value]) => [name, withoutTitles(value)]),
    );
  }
  for (const key of SUBSCHEMA_KEYS) {
    if (typeof rest[key] === 'object') rest[key] = withoutTitles(rest[key]);
  }
  for (const key of SUBSCHEMA_LIST_KEYS) {
    if (Array.isArray(rest[key])) rest[key] = withoutTitles(rest[key]);
  }
  return rest;
}

function typeName(provider: string, name: string): string {
  return `${pascalCase(provider)}${pascalCase(name)}Arguments`;
}

const WORD_SEPARATOR_RE = /[^A-Za-z0-9]+/;

function pascalCase(value: string): string {
  return value
    .split(WORD_SEPARATOR_RE)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join('');
}

function jsDoc(text: string): string {
  const lines = text.trim().replaceAll('*/', '*\\/').split('\n');
  return ['/**', ...lines.map((line) => ` * ${line}`.trimEnd()), ' */'].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const require = createRequire(import.meta.url);

function formatWithBiome(source: string, filePath: string): string {
  const biome = require.resolve('@biomejs/biome/bin/biome');
  const result = spawnSync(
    process.execPath,
    [biome, 'format', `--stdin-file-path=${relative(repositoryRoot, filePath)}`],
    {cwd: repositoryRoot, input: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024},
  );
  if (result.status !== 0) {
    throw new Error(`Biome could not format the generated tool catalog:\n${result.stderr}`);
  }
  return result.stdout;
}

export async function writeToolCatalogFile(catalogs: readonly ProviderToolCatalog[]) {
  const source = await renderToolCatalogSource(catalogs);
  await mkdir(dirname(generatedFilePath), {recursive: true});
  await writeFile(generatedFilePath, source);
  await writeFile(generatedGrantsFilePath, renderToolGrantsSource(catalogs));
}

/** Compares the committed files with a fresh render. */
export async function isToolCatalogFileCurrent(
  catalogs: readonly ProviderToolCatalog[],
): Promise<boolean> {
  const [types, grants] = await Promise.all(
    [generatedFilePath, generatedGrantsFilePath].map((path) =>
      readFile(path, 'utf8').catch(() => undefined),
    ),
  );
  return (
    types === (await renderToolCatalogSource(catalogs)) &&
    grants === renderToolGrantsSource(catalogs)
  );
}
