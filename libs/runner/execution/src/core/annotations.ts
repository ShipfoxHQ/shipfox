import {
  ANNOTATION_CONTEXT_MAX_LENGTH,
  type AnnotationStyleDto,
  annotationStyleSchema,
  type LeasedWriteAnnotationOperationDto,
} from '@shipfox/annotations-dto';
import {z} from 'zod';

function hasMaxCodePoints(value: string, maxCodePoints: number): boolean {
  let count = 0;
  for (const _codePoint of value) {
    count += 1;
    if (count > maxCodePoints) return false;
  }
  return true;
}

const annotationOperationFileBaseSchema = z.object({
  context: z
    .string()
    .trim()
    .min(1)
    .refine((value) => hasMaxCodePoints(value, ANNOTATION_CONTEXT_MAX_LENGTH), {
      message: `String must contain at most ${ANNOTATION_CONTEXT_MAX_LENGTH} character(s)`,
    }),
  style: annotationStyleSchema.optional(),
});

export const annotationOperationFileSchema = z.union([
  annotationOperationFileBaseSchema.extend({
    op: z.literal('replace').default('replace'),
    body: z.string(),
  }),
  annotationOperationFileBaseSchema.extend({
    op: z.literal('append'),
    body: z.string(),
  }),
  annotationOperationFileBaseSchema.extend({
    op: z.literal('remove'),
    body: z.never().optional(),
  }),
]);

export type AnnotationOperationFile = z.infer<typeof annotationOperationFileSchema>;

type AnnotationState =
  | {kind: 'replace'; style: AnnotationStyleDto; body: string}
  | {kind: 'append'; style: AnnotationStyleDto; body: string}
  | {kind: 'remove'};

export function resolveAnnotationOperations(args: {
  summary?: string | undefined;
  operations: readonly AnnotationOperationFile[];
}): LeasedWriteAnnotationOperationDto[] {
  const states = new Map<string, AnnotationState>();

  if (args.summary !== undefined && args.summary !== '') {
    states.set('default', {kind: 'replace', style: 'default', body: args.summary});
  }

  for (const operation of args.operations) {
    applyOperation(states, operation);
  }

  return [...states.entries()].map(([context, state]) => {
    if (state.kind === 'remove') return {context, op: 'remove', style: 'default'};
    return {context, op: state.kind, style: state.style, body: state.body};
  });
}

function applyOperation(
  states: Map<string, AnnotationState>,
  operation: AnnotationOperationFile,
): void {
  if (operation.op === 'replace') {
    states.set(operation.context, {
      kind: 'replace',
      style: operation.style ?? 'default',
      body: operation.body,
    });
    return;
  }

  if (operation.op === 'remove') {
    states.set(operation.context, {kind: 'remove'});
    return;
  }

  const prior = states.get(operation.context);
  if (!prior) {
    states.set(operation.context, {
      kind: 'append',
      style: operation.style ?? 'default',
      body: operation.body,
    });
    return;
  }

  if (prior.kind === 'remove') {
    states.set(operation.context, {
      kind: 'replace',
      style: operation.style ?? 'default',
      body: operation.body,
    });
    return;
  }

  states.set(operation.context, {
    kind: prior.kind,
    style: operation.style ?? prior.style,
    body: prior.body + operation.body,
  });
}
