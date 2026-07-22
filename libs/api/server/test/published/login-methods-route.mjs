const {loginMethodsResponseSchema} = await import('@shipfox/api-auth-dto');
const {createLoginMethodsRoute} = await import('@shipfox/api-server');
const {createApp} = await import('@shipfox/node-fastify');

const app = await createApp({
  auth: [],
  routes: [createLoginMethodsRoute({loginMethods: [{id: 'external-provider'}]})],
  swagger: false,
});

try {
  const response = await app.inject({method: 'GET', url: '/auth/login-methods'});
  if (response.statusCode !== 200) {
    throw new Error('Packed login-method catalog route did not respond.');
  }
  const body = loginMethodsResponseSchema.parse(response.json());
  if (body.login_methods[0]?.id !== 'external-provider') {
    throw new Error('Packed login-method catalog route returned an unexpected contract.');
  }
} finally {
  await app.close();
}
