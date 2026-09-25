import {type AgentThinking, agentThinkingSchema} from '@shipfox/workflow-document';
import type {WorkflowTemplateManifest} from './manifest.js';

export interface WorkflowModelAnchor {
  model: string;
  thinking: AgentThinking;
}

export type WorkflowModelAnchors = Readonly<Record<string, WorkflowModelAnchor>>;

const newlinePattern = /\r?\n/;
const indentationPattern = /^\s*/;
const modelMarkerPattern = /^\s*model\s*:\s*([^#\r\n]+?)\s+#\s*model:([a-z0-9][a-z0-9_-]*)\s*$/;
const modelCommentPattern = /#\s*model:/;
const thinkingLinePattern = /^(\s*)thinking\s*:\s*([^#\r\n]+?)\s*(?:#.*)?$/;

/** Extracts the tested model and thinking setting from each model marker in composed YAML. */
export function extractModelAnchors(composedYaml: string): WorkflowModelAnchors {
  const lines = composedYaml.split(newlinePattern);
  const anchors: Record<string, WorkflowModelAnchor> = {};

  for (const [index, line] of lines.entries()) {
    const marker = modelMarkerPattern.exec(line);
    if (marker !== null) {
      addModelAnchor(anchors, lines, index, marker);
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
    if (manifest.models[placeholder] === undefined) {
      throw new Error(`${manifest.id}: # model:${placeholder} has no manifest placeholder`);
    }
  }

  for (const placeholder of Object.keys(manifest.models)) {
    if (anchors[placeholder] === undefined) {
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
): void {
  const model = marker[1]?.trim();
  const placeholder = marker[2];
  if (model === undefined || model.length === 0 || placeholder === undefined) {
    throw new Error('Model marker has no model or placeholder');
  }

  const thinking = thinkingForMarkedStep(lines, modelLineIndex);
  const existing = anchors[placeholder];
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

function thinkingForMarkedStep(lines: readonly string[], modelLineIndex: number): AgentThinking {
  const modelLine = lines[modelLineIndex];
  if (modelLine === undefined) throw new Error('Model marker has no model line');

  const modelIndentation = indentationOf(modelLine);
  let start = modelLineIndex;
  while (start > 0 && isInsideMapping(lines[start - 1], modelIndentation)) start -= 1;

  let end = modelLineIndex + 1;
  while (end < lines.length && isInsideMapping(lines[end], modelIndentation)) end += 1;

  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const thinking = thinkingLinePattern.exec(line);
    if (thinking === null || indentationOf(line) !== modelIndentation) continue;

    const value = thinking[2]?.trim();
    const parsed = agentThinkingSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new Error(`Invalid thinking setting for model marker: ${value ?? ''}`);
  }

  throw new Error(`Model marker has no sibling thinking field: ${modelLine.trim()}`);
}

function isInsideMapping(line: string | undefined, modelIndentation: number): boolean {
  if (line === undefined || line.trim() === '' || line.trimStart().startsWith('#')) return true;
  return indentationOf(line) >= modelIndentation;
}

function indentationOf(line: string): number {
  return line.match(indentationPattern)?.[0].length ?? 0;
}
