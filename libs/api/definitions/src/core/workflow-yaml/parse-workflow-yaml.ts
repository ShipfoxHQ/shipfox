import {parseWorkflowDocument, type WorkflowDocument} from '@shipfox/workflow-document';
import yaml from 'js-yaml';
import type {WorkflowStepSourceLocationMap} from '../entities/workflow-model.js';
import {
  InvalidWorkflowYamlError,
  type WorkflowYamlLocation,
} from './invalid-workflow-yaml-error.js';
import {extractWorkflowStepSourceLocations} from './source-locations.js';

export interface ParsedWorkflowYaml {
  document: WorkflowDocument;
  stepSourceLocations: WorkflowStepSourceLocationMap;
}

export function parseWorkflowYaml(source: string): WorkflowDocument {
  return parseWorkflowDocument(loadWorkflowYaml(source));
}

export function parseWorkflowYamlWithLocations(source: string): ParsedWorkflowYaml {
  const parsed = loadWorkflowYaml(source);

  return {
    document: parseWorkflowDocument(parsed),
    stepSourceLocations: extractWorkflowStepSourceLocations(source),
  };
}

function loadWorkflowYaml(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = yaml.load(source);
  } catch (error) {
    throw new InvalidWorkflowYamlError(
      'syntax',
      `Invalid workflow YAML syntax: ${yamlErrorMessage(error)}`,
      {cause: error, location: yamlErrorLocation(error)},
    );
  }

  if (!isRecord(parsed)) {
    throw new InvalidWorkflowYamlError('non-object-root', 'Workflow YAML must parse to an object.');
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function yamlErrorMessage(error: unknown): string {
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof (error as {reason?: unknown}).reason === 'string'
  ) {
    return (error as {reason: string}).reason;
  }

  return error instanceof Error ? error.message : String(error);
}

function yamlErrorLocation(error: unknown): WorkflowYamlLocation | undefined {
  if (error === null || typeof error !== 'object') return undefined;

  const mark = (error as {mark?: unknown}).mark;
  if (mark === null || typeof mark !== 'object') return undefined;

  const line = (mark as {line?: unknown}).line;
  const column = (mark as {column?: unknown}).column;
  if (typeof line !== 'number' || typeof column !== 'number') return undefined;

  return {line: line + 1, column: column + 1};
}
