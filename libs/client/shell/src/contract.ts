import type {IconName} from '@shipfox/react-ui/icon';
import type {ComponentType, PropsWithChildren} from 'react';
import type {z} from 'zod';

export type AnchorId =
  | 'root'
  | 'workspaceLayout'
  | 'projectLayout'
  | 'workspaceSettings'
  | 'projectSettings';

/** A fixed shell anchor or the stable id of a feature-owned layout. */
export type RouteParentId = AnchorId | (string & {});

export interface RouteContribution {
  path: string;
  parent: RouteParentId;
  override?: boolean;
  impl: string;
}

export interface LayoutContribution {
  id: string;
  path: string;
  parent: RouteParentId;
  impl: string;
}

export interface FeatureProvider {
  id: string;
  Component: ComponentType<PropsWithChildren>;
}

interface NavTabEntryBase {
  id: string;
  label: string;
  to: string;
  exact?: boolean;
  order?: number;
}

export type NavTabEntry =
  | (NavTabEntryBase & {scope: 'workspace' | 'project'; layout?: never})
  | (NavTabEntryBase & {scope: 'layout'; layout: string; minimumRole?: string});

export type LayoutNavigationEntry = Extract<NavTabEntry, {scope: 'layout'}>;

export interface SettingsSectionEntry {
  id: string;
  pathSegment: string;
  label: string;
  icon: IconName;
  scope?: 'workspace' | 'project';
  order?: number;
}

export interface ProjectDockContribution {
  /**
   * Loads the dock in the browser. Use a dynamic import, so the manifest stays
   * Node-safe. The shell calls this again to retry after a failure.
   *
   * The component stays mounted on every project page while the panel is closed,
   * and remounts when the project changes. It draws its panel through
   * `ProjectDockPanel`, and must render its own close control.
   */
  load: () => Promise<{default: ComponentType}>;
}

export interface ClientFeature<S extends z.ZodRawShape = z.ZodRawShape> {
  id: string;
  /**
   * Set this to the feature id when the feature intentionally coordinates a
   * navigation or settings contribution whose route belongs to another
   * feature.
   */
  coordinator?: string;
  layouts?: readonly LayoutContribution[];
  routes?: readonly RouteContribution[];
  providers?: readonly FeatureProvider[];
  navigation?: readonly NavTabEntry[];
  settingsSections?: readonly SettingsSectionEntry[];
  /** One feature in a composition may contribute the project dock. */
  projectDock?: ProjectDockContribution;
  configShape?: S;
}

export function defineClientFeature<const T extends ClientFeature>(feature: T): T {
  return feature;
}
