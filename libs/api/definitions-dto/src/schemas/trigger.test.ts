import {triggerDtoSchema} from './trigger.js';

describe('triggerDtoSchema', () => {
  test('accepts canonical secret input names and source keys', () => {
    const result = triggerDtoSchema.safeParse({
      source: 'github',
      secrets: {DEPLOY_TOKEN: 'PROD_DEPLOY_TOKEN'},
    });

    expect(result.success).toBe(true);
  });

  test.each([
    ['non-canonical input name', {'deploy-token': 'PROD_DEPLOY_TOKEN'}],
    ['non-canonical source key', {DEPLOY_TOKEN: 'prod-token'}],
    ['overlong input name', {['A'.repeat(129)]: 'PROD_DEPLOY_TOKEN'}],
    ['overlong source key', {DEPLOY_TOKEN: 'A'.repeat(129)}],
  ])('rejects a %s', (_label, secrets) => {
    const result = triggerDtoSchema.safeParse({source: 'github', secrets});

    expect(result.success).toBe(false);
  });
});
