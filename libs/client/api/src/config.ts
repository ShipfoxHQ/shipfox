import {z} from 'zod';

/**
 * The config this module contributes to the composed app config. The app reads
 * the resolved value and passes it to `configureApiClient({baseUrl})`; this
 * module never reads the environment itself.
 */
export const apiConfigShape = {
  apiUrl: z
    .string()
    .url()
    .or(z.literal(''))
    .default('')
    .describe(
      'Base URL of the Shipfox API the browser calls, for example https://api.example.com. Leave empty to call the API on the same origin that serves the client.',
    ),
};
