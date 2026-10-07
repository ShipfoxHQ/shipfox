import type {AvailabilitySite, ExpressionTypeEnvironment} from '@shipfox/expression';
import type {WorkflowDocumentStep} from '@shipfox/workflow-document';
import type {WorkflowFieldTemplate} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {issue} from './validation-issue.js';

type DocumentPrompt = NonNullable<WorkflowDocumentStep['prompt']>;

export interface NormalizedAgentPrompt {
  readonly prompt: string;
  readonly template: WorkflowFieldTemplate | undefined;
}

/**
 * Joins a list prompt into the single string the model keeps. A string prompt
 * is returned untouched, so existing prompts and their hashes do not change.
 * A file part contributes the text read at the definition commit, and its
 * `${{ }}` expressions are checked against this step.
 */
export function normalizeAgentPrompt(params: {
  prompt: DocumentPrompt;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  /** Text of the prompt files, keyed by the `file` path as written in the YAML. */
  promptFiles?: ReadonlyMap<string, string> | undefined;
}): NormalizedAgentPrompt {
  const path = ['jobs', params.sourceName, 'steps', params.stepIndex, 'prompt'];
  const fieldParams = {
    field: 'agent.prompt',
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  } as const;

  if (typeof params.prompt === 'string') {
    const template = parseInterpolationField({
      ...fieldParams,
      source: params.prompt,
      path,
      issues: params.issues,
    });
    return {prompt: params.prompt, template};
  }

  const issueCount = params.issues.length;
  const texts: string[] = [];
  for (const [index, part] of params.prompt.entries()) {
    const partPath = [...path, index];
    if (typeof part === 'string') {
      const text = trimTrailingLineBreaks(part);
      texts.push(text);
      // `${{ }}` cannot span two parts, so each part is checked on its own.
      parseInterpolationField({
        ...fieldParams,
        source: text,
        path: partPath,
        issues: params.issues,
      });
      continue;
    }

    const fileText = params.promptFiles?.get(part.file);
    if (fileText === undefined) {
      params.issues.push(
        issue({
          code: 'prompt-file-invalid',
          message: `Prompt file "${part.file}" cannot be read here. Prompt files are read from the repository when a workflow is synced or run from a ref. Inline the prompt text.`,
          path: partPath,
          details: {file: part.file},
        }),
      );
      continue;
    }
    const text = trimTrailingLineBreaks(fileText);
    texts.push(text);
    const fileIssues: WorkflowModelValidationIssue[] = [];
    parseInterpolationField({...fieldParams, source: text, path: partPath, issues: fileIssues});
    for (const fileIssue of fileIssues) {
      params.issues.push({
        ...fileIssue,
        message: `Prompt file "${part.file}": ${fileIssue.message}`,
        details: {...fileIssue.details, file: part.file},
      });
    }
  }

  const prompt = texts.join('\n\n');
  if (params.issues.length > issueCount) return {prompt, template: undefined};

  const template = parseInterpolationField({
    ...fieldParams,
    source: prompt,
    path,
    issues: params.issues,
  });
  return {prompt, template};
}

function trimTrailingLineBreaks(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1;
  return text.slice(0, end);
}
