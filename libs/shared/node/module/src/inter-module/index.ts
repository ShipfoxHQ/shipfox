export type {InterModuleInternalErrorPhase, InterModuleReportInternalError} from './dispatch.js';
export {
  InterModuleCompositionError,
  InterModuleOpaqueError,
  InterModuleTransportStateError,
  InterModuleValidationError,
} from './errors.js';
export {registerInterModulePresentations} from './module-integration.js';
export {
  type CreateInMemoryInterModuleTransportOptions,
  createInMemoryInterModuleTransport,
  type InterModuleTransport,
} from './transport.js';
