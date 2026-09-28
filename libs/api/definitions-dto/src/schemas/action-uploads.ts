import {workflowDocumentActionPathIssue} from '@shipfox/workflow-document';
import {z} from 'zod';

/** UTF-8 bytes allowed across local workflow content and every uploaded action file. */
export const MAX_LOCAL_UPLOAD_BYTES = 1024 * 1024;

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/;

const actionUploadFileSchema = z.object({
  path: z.string().superRefine((path, ctx) => {
    const issue = actionFilePathIssue(path);
    if (issue !== undefined) ctx.addIssue({code: 'custom', message: issue});
  }),
  content: z.string(),
});

const actionUploadSchema = z.object({
  // Matched against `uses` verbatim, so it is not normalized.
  path: z.string().superRefine((path, ctx) => {
    const issue = workflowDocumentActionPathIssue(path);
    if (issue !== undefined) ctx.addIssue({code: 'custom', message: issue});
  }),
  files: z
    .array(actionUploadFileSchema)
    .min(1)
    .superRefine((files, ctx) => {
      addDuplicateIssues(
        files.map((file) => file.path),
        (index, path) =>
          ctx.addIssue({
            code: 'custom',
            path: [index, 'path'],
            message: `Duplicate action file path: ${path}`,
          }),
      );
    }),
});

/**
 * Whole action directories uploaded with a local dev run. Each entry replaces
 * the ref's copy of the directory its `uses` path names.
 */
export const actionUploadsSchema = z.array(actionUploadSchema).superRefine((uploads, ctx) => {
  addDuplicateIssues(
    uploads.map((upload) => upload.path),
    (index, path) =>
      ctx.addIssue({
        code: 'custom',
        path: [index, 'path'],
        message: `Duplicate action upload path: ${path}`,
      }),
  );
});

export type ActionUploadDto = z.infer<typeof actionUploadSchema>;

function actionFilePathIssue(path: string): string | undefined {
  if (path.startsWith('/') || WINDOWS_DRIVE_PATTERN.test(path)) {
    return 'Action file paths must be relative to the action directory.';
  }
  if (path.normalize('NFC') !== path) return 'Action file paths must be NFC-normalized.';
  const normalized =
    path.length > 0 &&
    !path.includes('\\') &&
    !path.includes('\u0000') &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  if (!normalized) {
    return 'Action file paths must be normalized: no empty, `.`, or `..` segments, and no backslashes.';
  }
  return undefined;
}

function addDuplicateIssues(
  paths: readonly string[],
  addIssue: (index: number, path: string) => void,
): void {
  const seen = new Set<string>();
  paths.forEach((path, index) => {
    if (seen.has(path)) addIssue(index, path);
    seen.add(path);
  });
}
