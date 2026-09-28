import {actionUploadsSchema} from './action-uploads.js';

const ACTION = './.shipfox/actions/notify';

function upload(filePath: string, path = ACTION) {
  return {path, files: [{path: filePath, content: ''}]};
}

describe('actionUploadsSchema', () => {
  test('accepts nested relative file paths', () => {
    const input = [
      {
        path: ACTION,
        files: [
          {path: 'action.yml', content: 'name: Notify'},
          {path: 'lib/format.ts', content: ''},
        ],
      },
    ];

    expect(actionUploadsSchema.parse(input)).toEqual(input);
  });

  test.each([
    '/etc/passwd',
    'C:/action.yml',
    '../action.yml',
    'lib/../action.yml',
    './action.yml',
    'lib//format.ts',
    'lib\\format.ts',
    '',
    'cafe\u0301.ts',
  ])('rejects the file path %j', (filePath) => {
    expect(actionUploadsSchema.safeParse([upload(filePath)]).success).toBe(false);
  });

  test.each([
    '.shipfox/actions/notify',
    './.shipfox/actions/notify/',
    './.shipfox/../notify',
    'owner/repo@v1',
  ])('rejects the action path %j', (path) => {
    expect(actionUploadsSchema.safeParse([upload('action.yml', path)]).success).toBe(false);
  });

  test('rejects duplicate file paths within an action', () => {
    const result = actionUploadsSchema.safeParse([
      {
        path: ACTION,
        files: [
          {path: 'index.ts', content: ''},
          {path: 'index.ts', content: ''},
        ],
      },
    ]);

    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: [0, 'files', 1, 'path'],
        message: 'Duplicate action file path: index.ts',
      }),
    ]);
  });

  test('rejects the same action uploaded twice', () => {
    const result = actionUploadsSchema.safeParse([upload('action.yml'), upload('action.yml')]);

    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: [1, 'path'],
        message: `Duplicate action upload path: ${ACTION}`,
      }),
    ]);
  });

  test('rejects an empty directory', () => {
    expect(actionUploadsSchema.safeParse([{path: ACTION, files: []}]).success).toBe(false);
  });
});
