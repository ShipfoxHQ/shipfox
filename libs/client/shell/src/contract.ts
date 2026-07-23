import type {IconName} from '@shipfox/react-ui/icon';
import type {ComponentType, PropsWithChildren} from 'react';
import type {z} from 'zod';

export type AnchorId = 'root' | 'workspaceLayout' | 'projectLayout' | 'workspaceSettings';

export interface RouteContribution {
  path: string;
  parent: AnchorId;
  override?: boolean;
  impl: string;
}

export interface FeatureProvider {
  id: string;
  Component: ComponentType<PropsWithChildren>;
}

export interface NavTabEntry {
  id: string;
  scope: 'workspace' | 'project';
  label: string;
  to: string;
  exact?: boolean;
  order?: number;
}

export interface SettingsSectionEntry {
  id: string;
  pathSegment: string;
  label: string;
  icon: IconName;
  order?: number;
}

export interface ClientFeature<S extends z.ZodRawShape = z.ZodRawShape> {
  id: string;
  /**
   * Set this to the feature id when the feature intentionally coordinates a
   * navigation or settings contribution whose route belongs to another
   * feature.
   */
  coordinator?: string;
  routes?: readonly RouteContribution[];
  providers?: readonly FeatureProvider[];
  navigation?: readonly NavTabEntry[];
  settingsSections?: readonly SettingsSectionEntry[];
  configShape?: S;
}

export function defineClientFeature<const T extends ClientFeature>(feature: T): T {
  return feature;
}
