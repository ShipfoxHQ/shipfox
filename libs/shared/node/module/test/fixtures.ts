import {defineInterModuleContract} from '@shipfox/inter-module';
import {z} from 'zod';

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
  },
});

export const ordersContract = defineInterModuleContract({
  module: 'orders',
  methods: {
    getOrderCountForWidget: {
      input: z.object({widgetId: z.string()}),
      output: z.object({count: z.number()}),
    },
  },
});
