import type {ShipfoxModule} from '@shipfox/node-module';
import {
  type CreateAgentAccessRoutesOptions,
  createAgentAccessRoutes,
} from '#presentation/routes.js';
import {createWorkflowTemplateRoutes} from '#presentation/workflow-template-routes.js';

export type CreateAgentAccessModuleOptions = CreateAgentAccessRoutesOptions;

/** Creates the agent-access module; default composition supplies producer clients. */
export function createAgentAccessModule(
  options: CreateAgentAccessModuleOptions = {},
): ShipfoxModule {
  const {templates, integrations} = options;
  return {
    name: 'agent-access',
    routes: [
      createAgentAccessRoutes(options),
      ...(templates === undefined || integrations === undefined
        ? []
        : [createWorkflowTemplateRoutes({templates, integrations})]),
    ],
  };
}

export const agentAccessModule = createAgentAccessModule();
