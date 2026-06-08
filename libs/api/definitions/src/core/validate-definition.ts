import {type WorkflowSpecDto, workflowSpecSchema} from '@shipfox/api-definitions-dto';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {normalizeWorkflowDocument} from '@shipfox/workflow-model';
import {parseWorkflowYamlSource} from '@shipfox/workflow-yaml';
import type {WorkflowSpec} from './entities/definition.js';

export type ValidationError = {message: string; path?: string | undefined};

export type ValidationResult =
  | {valid: true; spec: WorkflowSpec}
  | {valid: false; errors: ValidationError[]};

export function validateDefinition(yamlContent: string): ValidationResult {
  const yamlResult = parseWorkflowYamlSource(yamlContent);
  if (!yamlResult.valid) {
    return {
      valid: false,
      errors: yamlResult.diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        path: formatPath(diagnostic.path),
      })),
    };
  }

  const result = workflowSpecSchema.safeParse(yamlResult.value);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => ({
        message: issue.message,
        path: formatPath(toValidationPath(issue.path)),
      })),
    };
  }

  const spec = toWorkflowSpec(result.data);
  // The DTO owns platform compatibility, including legacy trigger `on`. The
  // model receives a strict document-shaped adapter so semantic checks can run
  // without changing the persisted WorkflowSpec shape in this PR.
  const document = toWorkflowDocument(spec);
  const modelResult = normalizeWorkflowDocument(document);

  if (!modelResult.valid) {
    return {
      valid: false,
      errors: modelResult.diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        path: formatPath(diagnostic.path),
      })),
    };
  }

  return {valid: true, spec};
}

function toWorkflowDocument(spec: WorkflowSpec): WorkflowDocument {
  return {
    name: spec.name,
    ...(spec.runner === undefined ? {} : {runner: spec.runner}),
    ...(spec.triggers === undefined
      ? {}
      : {
          triggers: Object.fromEntries(
            Object.entries(spec.triggers).map(([name, trigger]) => [
              name,
              {
                source: trigger.source,
                event: trigger.event,
                ...(trigger.with === undefined ? {} : {with: trigger.with}),
                ...(trigger.filter === undefined ? {} : {filter: trigger.filter}),
              },
            ]),
          ),
        }),
    jobs: Object.fromEntries(
      Object.entries(spec.jobs).map(([name, job]) => [
        name,
        {
          ...(job.needs === undefined ? {} : {needs: job.needs}),
          ...(job.runner === undefined ? {} : {runner: job.runner}),
          steps: job.steps.map((step) => ({
            ...(step.name === undefined ? {} : {name: step.name}),
            run: step.run,
          })),
        },
      ]),
    ),
  };
}

function toWorkflowSpec(dto: WorkflowSpecDto): WorkflowSpec {
  return {
    name: dto.name,
    ...(dto.runner === undefined ? {} : {runner: dto.runner}),
    ...(dto.triggers === undefined ? {} : {triggers: dto.triggers}),
    jobs: Object.fromEntries(
      Object.entries(dto.jobs).map(([name, job]) => [
        name,
        {
          ...(job.needs === undefined ? {} : {needs: job.needs}),
          ...(job.runner === undefined ? {} : {runner: job.runner}),
          steps: job.steps.map((step) => ({
            ...(step.name === undefined ? {} : {name: step.name}),
            run: step.run,
          })),
        },
      ]),
    ),
  };
}

function toValidationPath(path: readonly PropertyKey[]): Array<string | number> {
  return path.map((segment) => {
    if (typeof segment === 'number' || typeof segment === 'string') return segment;
    return String(segment);
  });
}

function formatPath(path: readonly (string | number)[]): string | undefined {
  if (path.length === 0) return undefined;
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    if (formatted.length === 0) return segment;
    return `${formatted}.${segment}`;
  }, '');
}
