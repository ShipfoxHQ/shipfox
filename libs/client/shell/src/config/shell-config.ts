import {apiConfigShape} from '@shipfox/client-api';
import {z} from 'zod';

export const shellConfigShape = {
  ...apiConfigShape,
  environment: z
    .enum(['development', 'staging', 'production'])
    .default('production')
    .describe('Deployment environment name shown in diagnostics and reported to monitoring.'),
};
