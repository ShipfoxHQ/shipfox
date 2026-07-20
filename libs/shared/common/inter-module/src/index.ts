export {
  createInterModuleClient,
  type InterModuleCallOptions,
  type InterModuleClient,
  type InterModuleDispatch,
  type InterModuleDispatchCall,
} from './client.js';
export {
  defineInterModuleContract,
  type InterModuleContract,
  type InterModuleContractDefinition,
  type InterModuleErrorSchemas,
  type InterModuleMethodContract,
  type InterModuleMethodContractOf,
  type InterModuleMethodDefinition,
} from './contract.js';
export {
  createInterModuleKnownError,
  hasInterModuleKnownErrorMarker,
  type InterModuleKnownError,
  type InterModuleKnownErrorFor,
  isInterModuleKnownError,
} from './known-error.js';
export {
  defineInterModulePresentation,
  type InterModuleHandler,
  type InterModuleHandlerContext,
  type InterModulePresentation,
  type InterModulePresentationHandlers,
} from './presentation.js';
