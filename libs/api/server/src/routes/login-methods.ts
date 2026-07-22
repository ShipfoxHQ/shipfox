import {loginMethodsResponseSchema} from '@shipfox/api-auth-dto';
import {defineRoute} from '@shipfox/node-fastify';
import type {LoginMethod} from '@shipfox/node-module';

export function createLoginMethodsRoute({loginMethods}: {loginMethods: readonly LoginMethod[]}) {
  return defineRoute({
    method: 'GET',
    path: '/auth/login-methods',
    description: 'List the login methods available in this server composition.',
    schema: {
      response: {
        200: loginMethodsResponseSchema,
      },
    },
    handler: () => ({
      login_methods: loginMethods.map(({id}) => ({id})),
    }),
  });
}
