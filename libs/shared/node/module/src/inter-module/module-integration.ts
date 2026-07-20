import type {ShipfoxModule} from '../types.js';
import type {InterModuleTransport} from './transport.js';

/**
 * Registers every module's declared `interModulePresentations` onto `transport`,
 * in array order. Call once, after building modules and before `transport.seal()`.
 */
export function registerInterModulePresentations(options: {
  transport: InterModuleTransport;
  modules: ShipfoxModule[];
}): void {
  for (const mod of options.modules) {
    for (const presentation of mod.interModulePresentations ?? []) {
      options.transport.register(presentation);
    }
  }
}
