import {z} from 'zod';

// One entry in a node's server-side evaluation trace: the resolved expression and
// the value that explain a filled field or a predicate outcome (e.g. why a job or
// step was skipped). Keys mirror the persisted trace, normalized to snake_case.
//
// Secrets-free by construction on the surfaces this DTO exposes: skip traces live
// on the job/step projection rows and only ever carry condition predicates, which
// may not reference `secrets` (enforced at authoring). See the Conditional
// execution design.
export const evaluationTraceEntryDtoSchema = z.object({
  // Authored field the entry explains: `job.if` / `step.if` for an explicit
  // condition, `job.default_gate` / `step.default_gate` for the implicit gate.
  field: z.string(),
  expression: z.string(),
  roots: z.array(z.string()),
  fill_target: z.string(),
  evaluated_at: z.string(),
  value: z.string().optional(),
  truncated: z.boolean().optional(),
  expr_truncated: z.boolean().optional(),
  reference: z.boolean().optional(),
  degraded: z.boolean().optional(),
  env_key: z.string().optional(),
});

export type EvaluationTraceEntryDto = z.infer<typeof evaluationTraceEntryDtoSchema>;

// Terminal marker appended when a trace exceeded its entry cap; carries how many
// entries were dropped rather than an evaluated field.
export const evaluationTraceLimitEntryDtoSchema = z.object({
  truncated: z.literal(true),
  dropped: z.number().int().nonnegative(),
});

export type EvaluationTraceLimitEntryDto = z.infer<typeof evaluationTraceLimitEntryDtoSchema>;

// A row's trace is a list of entries with an optional trailing limit marker. The
// entry schema is tried first: a limit entry lacks the required `field` /
// `expression` keys, so it falls through to the limit schema.
export const evaluationTraceRowEntryDtoSchema = z.union([
  evaluationTraceEntryDtoSchema,
  evaluationTraceLimitEntryDtoSchema,
]);

export type EvaluationTraceRowEntryDto = z.infer<typeof evaluationTraceRowEntryDtoSchema>;

export const evaluationTraceDtoSchema = z.array(evaluationTraceRowEntryDtoSchema);

export type EvaluationTraceDto = z.infer<typeof evaluationTraceDtoSchema>;
