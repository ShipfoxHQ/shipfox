import {type AgentThinking, agentThinkingSchema} from '@shipfox/workflow-document';
import {isMap, isScalar, isSeq, parseDocument, parse as parseYaml, type YAMLMap} from 'yaml';
import type {WorkflowTemplateManifest} from './manifest.js';

export interface WorkflowModelAnchor {
  model: string;
  thinking: AgentThinking;
}

export type WorkflowModelAnchors = Readonly<Record<string, WorkflowModelAnchor>>;

type SourceRange = readonly [number, number, number];

interface AnchorScanContext {
  blockScalarRanges: readonly SourceRange[];
  lineStarts: readonly number[];
  modelMappings: ReadonlyMap<number, YAMLMap>;
}

const newlinePattern = /\r?\n/;
const modelMarkerPattern = /^\s*model\s*:\s*([^#\r\n]*?)\s+#\s*model:([a-z0-9][a-z0-9_-]*)\s*$/;
const modelCommentPattern = /#\s*model:/;
const thinkingLinePattern = /^(\s*)thinking\s*:\s*([^#\r\n]+?)\s*(?:#.*)?$/;

/** Extracts the tested model and thinking setting from each model marker in composed YAML. */
export function extractModelAnchors(composedYaml: string): WorkflowModelAnchors {
  const lines = composedYaml.split(newlinePattern);
  const context = createAnchorScanContext(composedYaml);
  const anchors: Record<string, WorkflowModelAnchor> = Object.create(null);

  for (const [index, line] of lines.entries()) {
    if (isBlockScalarLine(context, index)) continue;

    const marker = modelMarkerPattern.exec(line);
    if (marker !== null) {
      addModelAnchor(anchors, lines, index, marker, context);
      continue;
    }
    if (modelCommentPattern.test(line)) {
      throw new Error(`Model marker must be on a model line: ${line.trim()}`);
    }
  }

  return anchors;
}

/** Validates that every composed model marker belongs to the template manifest. */
export function validateModelAnchors(
  manifest: Pick<WorkflowTemplateManifest, 'id' | 'models'>,
  composedYaml: string,
): WorkflowModelAnchors {
  const anchors = extractModelAnchors(composedYaml);

  for (const placeholder of Object.keys(anchors)) {
    if (!hasOwn(manifest.models, placeholder)) {
      throw new Error(`${manifest.id}: # model:${placeholder} has no manifest placeholder`);
    }
  }

  for (const placeholder of Object.keys(manifest.models)) {
    if (!hasOwn(anchors, placeholder)) {
      throw new Error(`${manifest.id}: models.${placeholder} has no # model:${placeholder} marker`);
    }
  }

  return anchors;
}

function addModelAnchor(
  anchors: Record<string, WorkflowModelAnchor>,
  lines: readonly string[],
  modelLineIndex: number,
  marker: RegExpExecArray,
  context: AnchorScanContext,
): void {
  const model = marker[1]?.trim();
  const placeholder = marker[2];
  if (model === undefined || model.length === 0 || placeholder === undefined) {
    throw new Error('Model marker has no model or placeholder');
  }

  const thinking = thinkingForMarkedStep(lines, modelLineIndex, context);
  const existing = hasOwn(anchors, placeholder) ? anchors[placeholder] : undefined;
  const conflicts =
    existing !== undefined && (existing.model !== model || existing.thinking !== thinking);
  if (conflicts) {
    throw new Error(
      `Conflicting model anchor for placeholder ${placeholder}: ` +
        `${existing.model}/${existing.thinking} and ${model}/${thinking}`,
    );
  }
  anchors[placeholder] = {model, thinking};
}

function thinkingForMarkedStep(
  lines: readonly string[],
  modelLineIndex: number,
  context: AnchorScanContext,
): AgentThinking {
  const mapping = context.modelMappings.get(modelLineIndex);
  const thinking = mapping === undefined ? undefined : thinkingFromMapping(mapping, lines, context);
  if (thinking !== undefined) return thinking;

  const modelLine = lines[modelLineIndex];
  throw new Error(`Model marker has no sibling thinking field: ${modelLine?.trim() ?? ''}`);
}

function thinkingFromMapping(
  mapping: YAMLMap,
  lines: readonly string[],
  context: AnchorScanContext,
): AgentThinking | undefined {
  const pair = findThinkingPair(mapping);
  if (pair === undefined) return undefined;

  if (!isScalar(pair.key)) return undefined;
  const thinkingLineIndex = lineIndexAtOffset(
    rangeStartOf(pair.key) ?? rangeStartOf(pair.value),
    context.lineStarts,
  );
  const line = thinkingLineIndex === undefined ? undefined : lines[thinkingLineIndex];
  const thinking = line === undefined ? undefined : thinkingLinePattern.exec(line);
  const value = parseThinkingScalar(thinking?.[2]?.trim());
  const parsed = agentThinkingSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(`Invalid thinking setting for model marker: ${thinking?.[2]?.trim() ?? ''}`);
}

function findThinkingPair(mapping: YAMLMap) {
  for (const pair of mapping.items) {
    if (!isScalar(pair.key)) continue;
    if (pair.key.value === 'thinking') return pair;
  }
  return undefined;
}

function parseThinkingScalar(source: string | undefined): unknown {
  if (source === undefined) return undefined;
  try {
    return parseYaml(source);
  } catch {
    return undefined;
  }
}

function createAnchorScanContext(composedYaml: string): AnchorScanContext {
  const lineStarts = lineStartsOf(composedYaml);
  const blockScalarRanges: SourceRange[] = [];
  const modelMappings = new Map<number, YAMLMap>();
  const document = parseDocument(composedYaml, {uniqueKeys: false});
  const firstError = document.errors[0];
  if (firstError !== undefined) {
    throw new Error(`Invalid composed YAML: ${firstError.message}`);
  }

  visitYamlNode(document.contents, lineStarts, blockScalarRanges, modelMappings);

  return {blockScalarRanges, lineStarts, modelMappings};
}

function visitYamlNode(
  node: unknown,
  lineStarts: readonly number[],
  blockScalarRanges: SourceRange[],
  modelMappings: Map<number, YAMLMap>,
): void {
  if (isMap(node)) {
    visitYamlMap(node, lineStarts, blockScalarRanges, modelMappings);
    return;
  }
  if (isSeq(node)) {
    visitYamlSequence(node, lineStarts, blockScalarRanges, modelMappings);
    return;
  }
  visitYamlScalar(node, blockScalarRanges);
}

function visitYamlMap(
  node: YAMLMap,
  lineStarts: readonly number[],
  blockScalarRanges: SourceRange[],
  modelMappings: Map<number, YAMLMap>,
): void {
  for (const pair of node.items) {
    const modelOffset =
      isScalar(pair.key) && pair.key.value === 'model' ? rangeStartOf(pair.key) : undefined;
    const modelLineIndex = lineIndexAtOffset(modelOffset, lineStarts);
    if (modelLineIndex !== undefined) modelMappings.set(modelLineIndex, node);
    visitYamlNode(pair.value, lineStarts, blockScalarRanges, modelMappings);
  }
}

function visitYamlSequence(
  node: {items: readonly unknown[]},
  lineStarts: readonly number[],
  blockScalarRanges: SourceRange[],
  modelMappings: Map<number, YAMLMap>,
): void {
  for (const item of node.items) {
    visitYamlNode(item, lineStarts, blockScalarRanges, modelMappings);
  }
}

function visitYamlScalar(node: unknown, blockScalarRanges: SourceRange[]): void {
  if (isScalar(node) && (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED')) {
    const range = rangeOf(node);
    if (range !== undefined) blockScalarRanges.push(range);
  }
}

function rangeStartOf(node: unknown): number | undefined {
  return rangeOf(node)?.[0];
}

function rangeOf(node: unknown): SourceRange | undefined {
  if (!isScalar(node) || node.range === null || node.range === undefined) return undefined;
  return node.range;
}

function isBlockScalarLine(context: AnchorScanContext, lineIndex: number): boolean {
  const lineStart = context.lineStarts[lineIndex];
  if (lineStart === undefined) return false;

  return context.blockScalarRanges.some(
    ([rangeStart, , rangeEnd]) => lineStart >= rangeStart && lineStart < rangeEnd,
  );
}

function lineStartsOf(source: string): number[] {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1);
  }
  return lineStarts;
}

function lineIndexAtOffset(
  offset: number | undefined,
  lineStarts: readonly number[],
): number | undefined {
  if (offset === undefined) return undefined;

  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle];
    const nextLineStart = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (lineStart !== undefined && offset >= lineStart && offset < nextLineStart) return middle;
    if (lineStart !== undefined && offset < lineStart) high = middle - 1;
    else low = middle + 1;
  }
  return undefined;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}
