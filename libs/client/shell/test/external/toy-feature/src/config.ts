import {z} from 'zod';

export const toyConfigShape = {
  fixtureGreeting: z.string().min(1).describe('Greeting required by the external fixture feature.'),
};
