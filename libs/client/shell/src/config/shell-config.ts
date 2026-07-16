import {z} from 'zod';

export const shellConfigShape = {
  apiUrl: z.url().default('/api').describe('Base URL for the Shipfox API.'),
  environment: z
    .enum(['development', 'staging', 'production'])
    .default('production')
    .describe('Deployment environment name shown in diagnostics and reported to monitoring.'),
};
