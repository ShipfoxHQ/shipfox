import {z} from 'zod';

export const logOutcomeSchema = z.enum(['drained', 'abandoned']);

export type LogOutcomeDto = z.infer<typeof logOutcomeSchema>;
