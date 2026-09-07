import {z} from 'zod';
import {administratorUserSummarySchema} from './admin.js';
import {impersonateResponseSchema} from './auth.js';

export const IMPERSONATION_WINDOW_MAX_COUNT = 5;
export const MAX_IMPERSONATION_WINDOWS = IMPERSONATION_WINDOW_MAX_COUNT;
export const IMPERSONATION_WINDOW_PAGE_LIMIT = 50;
export const IMPERSONATION_WINDOW_PAGE_MAX = 100;

const timestampSchema = z.string().datetime();
const windowIdSchema = z.string().uuid();
const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;
const WINDOW_CURSOR_MAX_LENGTH = 512;
const WINDOW_LIMIT_PATTERN = /^\d+$/u;

const windowReasonSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });

const windowCursorSchema = z
  .string()
  .min(1)
  .max(WINDOW_CURSOR_MAX_LENGTH)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });

const windowLimitSchema = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && WINDOW_LIMIT_PATTERN.test(value)) return Number(value);
  return value;
}, z.number().int().min(1).max(IMPERSONATION_WINDOW_PAGE_MAX));

export const impersonationWindowStartBodySchema = z.object({
  target_user_id: z.string().uuid(),
  reason: windowReasonSchema,
  required_workspace_id: z.string().uuid().optional(),
});

export type ImpersonationWindowStartBodyDto = z.infer<typeof impersonationWindowStartBodySchema>;

export const impersonationWindowContinueBodySchema = z.object({}).default({});

export type ImpersonationWindowContinueBodyDto = z.infer<
  typeof impersonationWindowContinueBodySchema
>;

export const impersonationWindowStopBodySchema = z
  .object({
    reason: windowReasonSchema.optional(),
  })
  .default({});

export type ImpersonationWindowStopBodyDto = z.infer<typeof impersonationWindowStopBodySchema>;

export const impersonationWindowContinueParamsSchema = z.object({
  windowId: windowIdSchema,
});

export type ImpersonationWindowContinueParamsDto = z.infer<
  typeof impersonationWindowContinueParamsSchema
>;

export const impersonationWindowStopParamsSchema = impersonationWindowContinueParamsSchema;

export type ImpersonationWindowStopParamsDto = z.infer<typeof impersonationWindowStopParamsSchema>;

export const impersonationWindowExactReadParamsSchema = impersonationWindowContinueParamsSchema;
export const impersonationWindowParamsSchema = impersonationWindowContinueParamsSchema;

export type ImpersonationWindowExactReadParamsDto = z.infer<
  typeof impersonationWindowExactReadParamsSchema
>;

const impersonationWindowTokenResponseSchema = impersonateResponseSchema.extend({
  window_id: windowIdSchema,
  window_started_at: timestampSchema,
  window_deadline: timestampSchema,
});

export const impersonationWindowStartResponseSchema = impersonationWindowTokenResponseSchema;

export type ImpersonationWindowStartResponseDto = z.infer<
  typeof impersonationWindowStartResponseSchema
>;

export const impersonationWindowContinueResponseSchema = impersonationWindowTokenResponseSchema;

export type ImpersonationWindowContinueResponseDto = z.infer<
  typeof impersonationWindowContinueResponseSchema
>;

const impersonationWindowMetadataSchema = z.object({
  window_id: windowIdSchema,
  actor: administratorUserSummarySchema,
  target: administratorUserSummarySchema,
  reason: windowReasonSchema,
  started_at: timestampSchema,
  deadline_at: timestampSchema,
});

export const impersonationWindowSummarySchema = impersonationWindowMetadataSchema;

export type ImpersonationWindowSummaryDto = z.infer<typeof impersonationWindowSummarySchema>;

export const impersonationWindowScopeSchema = z.enum(['owned', 'all']);

export type ImpersonationWindowScope = z.infer<typeof impersonationWindowScopeSchema>;

export const impersonationWindowsQuerySchema = z.object({
  scope: impersonationWindowScopeSchema.default('owned'),
  cursor: windowCursorSchema.optional(),
  limit: windowLimitSchema.default(IMPERSONATION_WINDOW_PAGE_LIMIT),
});

export type ImpersonationWindowsQueryDto = z.infer<typeof impersonationWindowsQuerySchema>;

export const impersonationWindowsResponseSchema = z.object({
  windows: z.array(impersonationWindowSummarySchema).max(IMPERSONATION_WINDOW_PAGE_MAX),
  next_cursor: windowCursorSchema.nullable(),
});

export type ImpersonationWindowsResponseDto = z.infer<typeof impersonationWindowsResponseSchema>;

export const impersonationWindowStateSchema = z.enum(['open', 'stopped', 'expired']);

export type ImpersonationWindowState = z.infer<typeof impersonationWindowStateSchema>;

export const impersonationWindowEndedReasonSchema = z.enum(['stopped', 'expired']);

export type ImpersonationWindowEndedReason = z.infer<typeof impersonationWindowEndedReasonSchema>;

export const impersonationWindowExactResponseSchema = z.discriminatedUnion('state', [
  impersonationWindowMetadataSchema.extend({
    state: z.literal('open'),
    ended_at: z.null(),
    ended_reason: z.null(),
  }),
  impersonationWindowMetadataSchema.extend({
    state: z.literal('stopped'),
    ended_at: timestampSchema,
    ended_reason: z.literal('stopped'),
  }),
  impersonationWindowMetadataSchema.extend({
    state: z.literal('expired'),
    ended_at: timestampSchema,
    ended_reason: z.literal('expired'),
  }),
]);

export type ImpersonationWindowExactResponseDto = z.infer<
  typeof impersonationWindowExactResponseSchema
>;

export const impersonationWindowStopResponseSchema = z.discriminatedUnion('state', [
  z.object({
    window_id: windowIdSchema,
    state: z.literal('stopped'),
    ended_at: timestampSchema,
  }),
  z.object({
    window_id: windowIdSchema,
    state: z.literal('expired'),
    ended_at: timestampSchema,
  }),
]);

export type ImpersonationWindowStopResponseDto = z.infer<
  typeof impersonationWindowStopResponseSchema
>;

export const impersonationWindowErrorCodeSchema = z.enum([
  'impersonation-window-not-found',
  'impersonation-window-stopped',
  'impersonation-window-deadline-reached',
  'impersonation-window-limit-reached',
  'impersonation-stop-reason-required',
  'impersonation-target-not-workspace-member',
]);

export type ImpersonationWindowErrorCode = z.infer<typeof impersonationWindowErrorCodeSchema>;

export const impersonationWindowErrorSchema = z.object({
  code: impersonationWindowErrorCodeSchema,
  message: z.string().optional(),
  details: z.unknown().optional(),
});

export type ImpersonationWindowErrorDto = z.infer<typeof impersonationWindowErrorSchema>;

export const impersonationWindowNotFoundErrorSchema = impersonationWindowErrorSchema.extend({
  code: z.literal('impersonation-window-not-found'),
});
export const impersonationWindowStoppedErrorSchema = impersonationWindowErrorSchema.extend({
  code: z.literal('impersonation-window-stopped'),
});
export const impersonationWindowDeadlineReachedErrorSchema = impersonationWindowErrorSchema.extend({
  code: z.literal('impersonation-window-deadline-reached'),
});
export const impersonationWindowLimitReachedErrorSchema = impersonationWindowErrorSchema.extend({
  code: z.literal('impersonation-window-limit-reached'),
});
export const impersonationStopReasonRequiredErrorSchema = impersonationWindowErrorSchema.extend({
  code: z.literal('impersonation-stop-reason-required'),
});
export const impersonationTargetNotWorkspaceMemberErrorSchema =
  impersonationWindowErrorSchema.extend({
    code: z.literal('impersonation-target-not-workspace-member'),
  });

export const impersonationWindowErrorResponseSchema = impersonationWindowErrorSchema;

export type ImpersonationWindowErrorResponseDto = z.infer<
  typeof impersonationWindowErrorResponseSchema
>;

export const listImpersonationWindowsQuerySchema = impersonationWindowsQuerySchema;
export const listImpersonationWindowsResponseSchema = impersonationWindowsResponseSchema;
export const getImpersonationWindowResponseSchema = impersonationWindowExactResponseSchema;
export const impersonateWindowStartBodySchema = impersonationWindowStartBodySchema;
export const impersonateWindowStartResponseSchema = impersonationWindowStartResponseSchema;
export const impersonateWindowContinueResponseSchema = impersonationWindowContinueResponseSchema;
export const impersonateWindowStopBodySchema = impersonationWindowStopBodySchema;
export const impersonateWindowStopResponseSchema = impersonationWindowStopResponseSchema;

export type ImpersonateWindowStartBodyDto = ImpersonationWindowStartBodyDto;
export type ImpersonateWindowStartResponseDto = ImpersonationWindowStartResponseDto;
export type ImpersonateWindowContinueResponseDto = ImpersonationWindowContinueResponseDto;
export type ImpersonateWindowStopBodyDto = ImpersonationWindowStopBodyDto;
export type ImpersonateWindowStopResponseDto = ImpersonationWindowStopResponseDto;
