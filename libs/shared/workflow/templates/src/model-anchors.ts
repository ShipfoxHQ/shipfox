import {type AgentThinking, agentThinkingSchema} from '@shipfox/workflow-document';
import {isMap, isScalar, isSeq, type Pair, parseDocument, type Scalar} from 'yaml';

export interface ModelAnchor {
  model: string;
  thinking: AgentThinking;
}

export type ModelAnchors = Readonly<Record<string, ModelAnchor>>;

const modelMarkerPattern = /^\s*model:([a-z0-9][a-z0-9_-]*)\s*$/;
const modelMarkerCommentPattern = /#\s*model:/;

/** Reads the tested model and thinking level from every marked agent step. */
export function extractModelAnchors(composedYaml: string): ModelAnchors {
  if (!modelMarkerCommentPattern.test(composedYaml)) return {};

  const document = parseDocument(composedYaml);
  if (document.errors.length > 0) {
    throw new Error(`Invalid composed workflow YAML: ${document.errors[0]?.message}`);
  }

  const anchors = new Map<string, ModelAnchor>();
  collectAnchors(document.contents, anchors);
  return Object.fromEntries(anchors);
}

function collectAnchors(node: unknown, anchors: Map<string, ModelAnchor>): void {
  if (isMap(node)) {
    collectMapAnchors(node.items, anchors);
    for (const pair of node.items) {
      collectAnchors(pair.key, anchors);
      collectAnchors(pair.value, anchors);
    }
    return;
  }

  if (isSeq(node)) {
    for (const item of node.items) collectAnchors(item, anchors);
  }
}

function collectMapAnchors(items: readonly Pair[], anchors: Map<string, ModelAnchor>): void {
  for (const pair of items) {
    const markedModel = readMarkedModel(pair);
    if (markedModel === undefined) continue;

    const thinking = readThinking(items, markedModel.marker);
    const anchor = {model: markedModel.model, thinking};
    const previous = anchors.get(markedModel.marker);
    if (previous !== undefined && !sameAnchor(previous, anchor)) {
      throw new Error(
        `Conflicting model anchors for "${markedModel.marker}": ${previous.model}/${previous.thinking} and ${anchor.model}/${anchor.thinking}`,
      );
    }
    anchors.set(markedModel.marker, anchor);
  }
}

function readMarkedModel(pair: Pair): {marker: string; model: string} | undefined {
  if (!isScalar(pair.key) || pair.key.value !== 'model' || !isScalar(pair.value)) return undefined;

  const marker = readModelMarker(pair.value);
  if (marker === undefined) return undefined;
  if (typeof pair.value.value !== 'string') {
    throw new Error(`Model marker "${marker}" must identify a string model`);
  }

  return {marker, model: pair.value.value};
}

function readThinking(items: readonly Pair[], marker: string): AgentThinking {
  const thinkingPair = items.find(
    (candidate) => isScalar(candidate.key) && candidate.key.value === 'thinking',
  );
  if (thinkingPair === undefined || !isScalar(thinkingPair.value)) {
    throw new Error(`Marked model step "${marker}" is missing thinking`);
  }

  const thinking = agentThinkingSchema.safeParse(thinkingPair.value.value);
  if (!thinking.success) throw new Error(`Marked model step "${marker}" has invalid thinking`);
  return thinking.data;
}

function sameAnchor(left: ModelAnchor, right: ModelAnchor): boolean {
  return left.model === right.model && left.thinking === right.thinking;
}

function readModelMarker(value: Scalar): string | undefined {
  const comment = value.comment;
  if (typeof comment !== 'string') return undefined;

  return modelMarkerPattern.exec(comment)?.[1];
}
