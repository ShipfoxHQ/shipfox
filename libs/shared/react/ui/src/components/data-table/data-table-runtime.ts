export function shouldAssertDataTableNavigationContract(
  buildDevelopment: boolean | undefined,
  nodeEnvironment: string | undefined,
) {
  return (
    buildDevelopment === true || nodeEnvironment === 'development' || nodeEnvironment === 'test'
  );
}
