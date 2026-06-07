import type {
  DefaultAcceptanceExpressionReference,
  ExpressionSupportReference,
} from '#core/ir/expression-language-reference.js';
import type {
  IrIdRuleReference,
  IrNormalizationRuleReference,
} from '#core/ir/normalization-reference.js';
import type {StaticDiagnosticReference} from '#core/static-semantics/static-diagnostic-reference.js';
import type {
  SurfaceSchemaReference,
  SurfaceValidationRuleReference,
} from '#core/surface/surface-schema-reference.js';
import type {SurfaceCueBoundaryReference} from '#core/surface/surface-workflow-document-cue.js';
import type {
  ConceptChangeChecklistReference,
  DocGenerationCapabilityReference,
  RequirementStatusReference,
} from './formalization-process-reference.js';
import type {
  FormalizationDocumentRoleReference,
  FormalizationStatusMeaningReference,
} from './formalization-readme-reference.js';

export function renderSurfaceSchemaReferenceSections(
  references: readonly SurfaceSchemaReference[],
): readonly string[] {
  return references.map((reference) =>
    [
      `#### ${reference.typeName}`,
      '',
      renderMarkdownTable(
        ['Field', 'Presence', 'Type', 'Notes'],
        reference.fields.map((field) => [
          `\`${field.name}\``,
          field.presence,
          `\`${field.surfaceType}\``,
          field.notes,
        ]),
      ),
    ].join('\n'),
  );
}

export function renderSurfaceValidationRuleReference(
  rules: readonly SurfaceValidationRuleReference[],
): string {
  return [
    '### Generated Surface Validation Rules',
    '',
    renderMarkdownTable(
      ['Rule', 'Scope', 'Source', 'Behavior'],
      rules.map((rule) => [`\`${rule.id}\``, rule.scope, `\`${rule.source}\``, rule.rule]),
    ),
  ].join('\n');
}

export function renderSurfaceCueFieldMap(references: readonly SurfaceSchemaReference[]): string {
  return [
    '### Generated Zod To CUE Field Map',
    '',
    renderMarkdownTable(
      ['Surface Object', 'CUE Definition', 'Field', 'Presence', 'Surface Type', 'CUE Type'],
      references.flatMap((reference) =>
        reference.fields.map((field) => [
          reference.typeName,
          `\`${reference.cueDefinition}\``,
          `\`${field.name}\``,
          field.presence,
          `\`${field.surfaceType}\``,
          `\`${field.cueType}\``,
        ]),
      ),
    ),
  ].join('\n');
}

export function renderSurfaceCueBoundaryReference(
  references: readonly SurfaceCueBoundaryReference[],
): string {
  return [
    '### Generated PR1 CUE Boundary',
    '',
    renderMarkdownTable(
      ['Capability', 'PR1 Status', 'Behavior', 'Next Required Work'],
      references.map((reference) => [
        reference.capability,
        reference.pr1Status,
        reference.behavior,
        reference.nextRequiredWork,
      ]),
    ),
  ].join('\n');
}

export function renderStaticDiagnosticReference(
  diagnostics: readonly StaticDiagnosticReference[],
): string {
  return [
    '### Generated Static Diagnostic Reference',
    '',
    renderMarkdownTable(
      ['ID', 'Severity', 'Condition', 'Path Shape', 'Message Example', 'Notes'],
      diagnostics.map((diagnostic) => [
        `\`${diagnostic.id}\``,
        diagnostic.severity,
        diagnostic.condition,
        diagnostic.pathShape,
        diagnostic.messageExample,
        diagnostic.notes,
      ]),
    ),
  ].join('\n');
}

export function renderRequirementStatusReference(
  references: readonly RequirementStatusReference[],
): string {
  return [
    '### Generated PR1 Requirement Status',
    '',
    renderMarkdownTable(
      ['Requirement', 'PR1 Status', 'Primary Docs', 'Primary Code'],
      references.map((reference) => [
        reference.requirement,
        reference.pr1Status,
        reference.primaryDocs.map(formatCode).join(', '),
        reference.primaryCode.map(formatCode).join(', '),
      ]),
    ),
  ].join('\n');
}

export function renderConceptChangeChecklistReference(
  references: readonly ConceptChangeChecklistReference[],
): string {
  return [
    '### Generated Concept Change Checklist',
    '',
    renderMarkdownTable(
      ['Step', 'Layer', 'Action', 'Required Artifacts', 'Expected Tests', 'Generated Docs Impact'],
      references.map((reference) => [
        String(reference.step),
        reference.layer,
        reference.action,
        reference.requiredArtifacts,
        reference.expectedTests,
        reference.generatedDocsImpact,
      ]),
    ),
  ].join('\n');
}

export function renderDocGenerationCapabilityReference(
  references: readonly DocGenerationCapabilityReference[],
): string {
  return [
    '### Generated Generator Capability Reference',
    '',
    renderMarkdownTable(
      ['Capability', 'Owner', 'Inputs', 'Output Docs', 'Tests'],
      references.map((reference) => [
        reference.capability,
        reference.owners.map(formatCode).join(', '),
        reference.inputs,
        reference.outputDocs.map(formatCode).join(', '),
        reference.tests.map(formatCode).join(', '),
      ]),
    ),
  ].join('\n');
}

export function renderFormalizationStatusMeaningReference(
  references: readonly FormalizationStatusMeaningReference[],
): string {
  return renderMarkdownTable(
    ['Status', 'Meaning'],
    references.map((reference) => [formatReadmeStatus(reference.status), reference.meaning]),
  );
}

export function renderFormalizationDocumentRoleReference(
  references: readonly FormalizationDocumentRoleReference[],
): string {
  return renderMarkdownTable(
    ['Doc', 'Status', 'Generated', 'Generator Owner', 'Role'],
    references.map((reference) => [
      formatCode(reference.fileName),
      formatReadmeStatus(reference.status),
      reference.generated ? 'yes' : 'no',
      formatCode(reference.generatorOwner),
      reference.role,
    ]),
  );
}

export function renderDefaultAcceptanceExpressionReference(
  reference: DefaultAcceptanceExpressionReference,
): string {
  return [
    '### Generated Default Acceptance Expression',
    '',
    renderMarkdownTable(
      ['Policy Kind', 'Expression', 'Expression Tree', 'Notes'],
      [
        [
          `\`${reference.policyKind}\``,
          `\`${reference.expression}\``,
          `\`${JSON.stringify(reference.expressionTree)}\``,
          reference.notes,
        ],
      ],
    ),
  ].join('\n');
}

export function renderExpressionSupportReference(
  references: readonly ExpressionSupportReference[],
): string {
  return [
    '### Generated Expression Support Matrix',
    '',
    renderMarkdownTable(
      ['Concept', 'PR1 Status', 'Owner', 'PR1 Behavior', 'Next Required Work'],
      references.map((reference) => [
        reference.concept,
        reference.status,
        `\`${reference.owner}\``,
        reference.pr1Behavior,
        reference.nextRequiredWork,
      ]),
    ),
  ].join('\n');
}

export function renderIrIdRuleReference(references: readonly IrIdRuleReference[]): string {
  return [
    '### Generated IR ID Rule Reference',
    '',
    renderMarkdownTable(
      ['Rule', 'Input', 'Generated ID', 'Owner', 'Notes'],
      references.map((reference) => [
        reference.rule,
        reference.input,
        `\`${reference.generatedId}\``,
        `\`${reference.owner}\``,
        reference.notes,
      ]),
    ),
  ].join('\n');
}

export function renderIrNormalizationRuleReference(
  references: readonly IrNormalizationRuleReference[],
): string {
  return [
    '### Generated IR Normalization Rule Reference',
    '',
    renderMarkdownTable(
      ['Concept', 'Surface Input', 'IR Behavior', 'Owner'],
      references.map((reference) => [
        reference.concept,
        reference.surfaceInput,
        reference.irBehavior,
        `\`${reference.owner}\``,
      ]),
    ),
  ].join('\n');
}

function renderMarkdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  return [
    `| ${headers.map(escapeTableCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeTableCell).join(' | ')} |`),
  ].join('\n');
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|');
}

function formatCode(value: string): string {
  return value === 'deferred' ? value : `\`${value}\``;
}

function formatReadmeStatus(value: string): string {
  return `\`${value}\``;
}
