import type {BuiltinProviderConfig, CustomProviderConfig, SupportedProvider} from './models.js';

export type ManagementModal =
  | {readonly kind: 'closed'}
  | {readonly kind: 'configure-builtin'; readonly provider: SupportedProvider}
  | {
      readonly kind: 'edit-builtin';
      readonly provider: SupportedProvider;
      readonly config: BuiltinProviderConfig;
    }
  | {
      readonly kind: 'change-default-model';
      readonly provider: SupportedProvider;
      readonly config: BuiltinProviderConfig;
    }
  | {readonly kind: 'create-custom'}
  | {readonly kind: 'edit-custom'; readonly config: CustomProviderConfig}
  | {
      readonly kind: 'show-usage';
      readonly providerId: string;
      readonly initialModel: string | null;
    };

export type ManagementModalAction =
  | {readonly type: 'close'}
  | {readonly type: 'configure-builtin'; readonly provider: SupportedProvider}
  | {
      readonly type: 'edit-builtin';
      readonly provider: SupportedProvider;
      readonly config: BuiltinProviderConfig;
    }
  | {
      readonly type: 'change-default-model';
      readonly provider: SupportedProvider;
      readonly config: BuiltinProviderConfig;
    }
  | {readonly type: 'create-custom'}
  | {readonly type: 'edit-custom'; readonly config: CustomProviderConfig}
  | {
      readonly type: 'show-usage';
      readonly providerId: string;
      readonly initialModel: string | null;
    };

export function managementModalReducer(
  _state: ManagementModal,
  action: ManagementModalAction,
): ManagementModal {
  switch (action.type) {
    case 'close':
      return {kind: 'closed'};
    case 'configure-builtin':
      return {kind: 'configure-builtin', provider: action.provider};
    case 'edit-builtin':
      return {kind: 'edit-builtin', provider: action.provider, config: action.config};
    case 'change-default-model':
      return {kind: 'change-default-model', provider: action.provider, config: action.config};
    case 'create-custom':
      return {kind: 'create-custom'};
    case 'edit-custom':
      return {kind: 'edit-custom', config: action.config};
    case 'show-usage':
      return {kind: 'show-usage', providerId: action.providerId, initialModel: action.initialModel};
  }
}
