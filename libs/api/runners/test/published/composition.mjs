const {createRunnersModule} = await import('@shipfox/api-runners');
const module = createRunnersModule({
  auth: {},
  installationProvisioning: {
    policy: {
      filterEligibleWorkspaceIds: async (workspaceIds) => new Set(workspaceIds),
    },
  },
});

if (module.name !== 'runners' || !module.routes?.length) {
  throw new Error('Packed API runners does not compose the installation provisioning policy.');
}
