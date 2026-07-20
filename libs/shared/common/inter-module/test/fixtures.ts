import {z} from 'zod';
import {defineInterModuleContract} from '#contract.js';

export const widgetsContract = defineInterModuleContract({
  module: 'widgets',
  methods: {
    getWidget: {
      input: z.object({id: z.string()}),
      output: z.object({id: z.string(), name: z.string()}),
      errors: {
        'not-found': z.object({id: z.string()}),
      },
    },
    createWidget: {
      input: z.object({name: z.string()}),
      output: z.object({id: z.string(), name: z.string()}),
      errors: {
        conflict: z.object({name: z.string()}),
      },
    },
  },
});
