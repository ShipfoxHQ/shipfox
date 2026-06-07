export const staticDiagnosticIds = {
  unknownJobDependency: 'SS001_UNKNOWN_JOB_DEPENDENCY',
  selfJobDependency: 'SS002_SELF_JOB_DEPENDENCY',
  cyclicJobDependency: 'SS003_CYCLIC_JOB_DEPENDENCY',
  unknownDependentJob: 'SS004_UNKNOWN_DEPENDENT_JOB',
} as const;

export type StaticDiagnosticId = (typeof staticDiagnosticIds)[keyof typeof staticDiagnosticIds];

export type StaticDiagnosticSeverity = 'error';

export type StaticDiagnostic = Readonly<{
  id: StaticDiagnosticId;
  severity: StaticDiagnosticSeverity;
  message: string;
  path: readonly (string | number)[];
}>;

export type StaticSemanticsResult =
  | {valid: true; diagnostics: []}
  | {valid: false; diagnostics: StaticDiagnostic[]};
